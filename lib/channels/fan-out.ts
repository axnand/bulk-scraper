// ─── Fan-out: create ChannelThreads when a task is shortlisted ────────────────
//
// Called after a task reaches SHORTLISTED stage (either by auto-shortlist
// in the worker or manual promotion). Evaluates every active Channel for
// the requisition and creates one ChannelThread per matching channel.
//
// Idempotent: the @@unique([taskId, channelId]) constraint prevents duplicates,
// so calling this multiple times is safe.

import { prisma } from "@/lib/prisma";
import { ChannelType } from "@prisma/client";
import { matchRule, type LinkedInConfig, type EmailConfig, type WAConfig } from "./types";
import { triggerOutreach } from "@/lib/trigger";

export async function fanOutToChannels(taskId: string, jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { requisitionId: true },
  });
  if (!job?.requisitionId) return;

  const [task, channels] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      select: {
        analysisResult: true,
        channelThreads: { select: { channelId: true } },
      },
    }),
    prisma.channel.findMany({
      where: { requisitionId: job.requisitionId, status: "ACTIVE" },
    }),
  ]);

  if (!task || channels.length === 0) return;

  let analysis: { scorePercent?: number } | null = null;
  if (task.analysisResult) {
    try {
      analysis = JSON.parse(task.analysisResult as string);
    } catch (err: any) {
      console.error(`[fanOutToChannels] Task ${taskId} has malformed analysisResult: ${err.message}`);
      // proceed with score=0 rather than crashing — a malformed analysis shouldn't block fan-out entirely
    }
  }
  const score: number = analysis?.scorePercent ?? 0;
  const existingChannelIds = new Set(task.channelThreads.map(t => t.channelId));

  const failures: Array<{ channelId: string; error: Error }> = [];

  for (const channel of channels) {
    if (existingChannelIds.has(channel.id)) continue;

    const config = channel.config as Record<string, unknown>;
    let matchedRuleKey: string | null = null;
    let followupsTotal = 0;

    if (channel.type === ChannelType.LINKEDIN) {
      const cfg = config as unknown as LinkedInConfig;
      const rule = matchRule(score, cfg.inviteRules ?? []);
      if (!rule) continue;
      matchedRuleKey = rule.key;
      followupsTotal = (cfg.followups ?? []).length;
    } else if (channel.type === ChannelType.EMAIL) {
      const cfg = config as unknown as EmailConfig;
      const rule = matchRule(score, cfg.emailRules ?? []);
      if (!rule) continue;
      matchedRuleKey = rule.key;
      followupsTotal = (cfg.followups ?? []).length;
    } else if (channel.type === ChannelType.WHATSAPP) {
      const cfg = config as unknown as WAConfig;
      const rule = matchRule(score, cfg.waRules ?? []);
      if (!rule) continue;
      matchedRuleKey = rule.key;
      followupsTotal = (cfg.followups ?? []).length;
    }

    try {
      await prisma.channelThread.create({
        data: {
          taskId,
          channelId: channel.id,
          channelType: channel.type,
          matchedRuleKey,
          followupsTotal,
          nextActionAt: new Date(),
        },
      });
    } catch (err: any) {
      // P2002 = unique([taskId, channelId]) — thread already exists, safe to skip
      if (err?.code === "P2002") continue;
      console.error(`[fanOutToChannels] Task ${taskId} channel ${channel.id} thread creation failed: ${err.message}`);
      failures.push({ channelId: channel.id, error: err });
    }
  }

  // Kick the outreach-tick cron immediately — newly created threads have
  // nextActionAt=now() and would otherwise wait up to ~60s for the next tick.
  triggerOutreach();

  if (failures.length > 0) {
    throw new Error(
      `fanOutToChannels: ${failures.length}/${channels.length} channel(s) failed for task ${taskId}: ` +
      failures.map(f => `${f.channelId}=${f.error.message}`).join("; ")
    );
  }
}

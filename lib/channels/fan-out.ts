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
  try {
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

    const analysis = task.analysisResult ? JSON.parse(task.analysisResult as string) : null;
    const score: number = analysis?.scorePercent ?? 0;
    const existingChannelIds = new Set(task.channelThreads.map(t => t.channelId));

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

      // Create thread — nextActionAt = now so the cron picks it up immediately
      await prisma.channelThread.create({
        data: {
          taskId,
          channelId: channel.id,
          channelType: channel.type,
          matchedRuleKey,
          followupsTotal,
          nextActionAt: new Date(),
        },
      }).catch((err: Error) => {
        // Unique constraint violation = thread already exists — safe to ignore
        if ((err as any).code === "P2002") return;
        throw err;
      });
    }
    // Kick the outreach-tick cron immediately — newly created threads have
    // nextActionAt=now() and would otherwise wait up to ~60s for the next tick.
    triggerOutreach(); // fire-and-forget; never throws into the parent flow
  } catch (err: any) {
    // Fan-out is best-effort — log but never fail the parent flow
    console.warn(`[fanOutToChannels] Task ${taskId} fan-out failed: ${err.message}`);
  }
}

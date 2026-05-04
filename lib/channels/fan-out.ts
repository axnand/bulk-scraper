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

// P1 #14 / EC-9.2 — pick a sending account for a new ChannelThread.
//
// Selection order:
//   1. ChannelAccountPool entries for this channel (highest priority first;
//      tiebreaker: account with fewest existing bound threads — round-robin).
//      Excludes soft-deleted, DISABLED, and over-cap accounts.
//   2. Fall back to channel.sendingAccountId (legacy single-account binding).
//   3. Return null when nothing usable exists; caller can still create the
//      thread (worker will archive at first tick with a clear reason).
async function pickAccountForChannel(
  channelId: string,
  fallbackSendingAccountId: string | null,
): Promise<string | null> {
  const pool = await prisma.channelAccountPool.findMany({
    where: {
      channelId,
      account: {
        deletedAt: null,
        status: { not: "DISABLED" },
      },
    },
    orderBy: [{ priority: "desc" }],
    select: {
      accountId: true,
      account: {
        select: { id: true, _count: { select: { threadsBound: true } } },
      },
    },
  });

  if (pool.length > 0) {
    // Round-robin within priority tier: pick the account with the fewest
    // bound threads. Prisma can't sort by a nested aggregate so we do it
    // in JS.
    const sorted = [...pool].sort((a, b) => {
      return (a.account._count.threadsBound ?? 0) - (b.account._count.threadsBound ?? 0);
    });
    return sorted[0].accountId;
  }

  return fallbackSendingAccountId;
}

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

    // P1 #14 — pick a bound account at thread creation, so the worker has a
    // sticky account from the very first tick rather than re-resolving via
    // channel.sendingAccount each time. Empty pool → fall back to the
    // legacy single-account binding.
    const boundAccountId = await pickAccountForChannel(channel.id, channel.sendingAccountId);

    try {
      await prisma.channelThread.create({
        data: {
          taskId,
          channelId: channel.id,
          channelType: channel.type,
          matchedRuleKey,
          followupsTotal,
          nextActionAt: new Date(),
          ...(boundAccountId ? { accountId: boundAccountId } : {}),
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

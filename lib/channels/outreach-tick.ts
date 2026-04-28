// ─── Outreach tick — shared scheduler logic ──────────────────────────────────
//
// Extracted so it can be invoked directly from the worker process (in-process
// setInterval) and from the HTTP cron route. Avoids depending on an HTTP fetch
// that requires NEXT_PUBLIC_APP_URL to be set.

import { prisma } from "@/lib/prisma";
import { processThread, markThreadReplied } from "@/lib/channels/thread-worker";
import { listSentInvitations, listChatMessages } from "@/lib/services/unipile.service";
import { recomputeTaskStage } from "@/lib/channels/stage-rollup";

const MAX_PER_TICK = 200;
const RETRY_DELAY_MS = 5 * 60 * 1000;

export async function runOutreachTick(): Promise<{
  processed: number;
  failed: number;
  total: number;
  pollAccepted: number;
}> {
  const now = new Date();

  let claimedIds: string[] = [];
  try {
    const claimed = await prisma.$queryRaw<{ id: string }[]>`
      WITH claimed AS (
        UPDATE "ChannelThread"
        SET "nextActionAt" = NULL
        WHERE id IN (
          SELECT id
          FROM   "ChannelThread"
          WHERE  status IN ('PENDING', 'ACTIVE')
            AND  "nextActionAt" IS NOT NULL
            AND  "nextActionAt" <= ${now}
          ORDER  BY "nextActionAt" ASC
          LIMIT  ${MAX_PER_TICK}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id
      )
      SELECT id FROM claimed
    `;
    claimedIds = claimed.map(r => r.id);
  } catch (err: any) {
    console.error("[OutreachTick] Failed to claim threads:", err.message);
    return { processed: 0, failed: 0, total: 0, pollAccepted: 0 };
  }

  if (claimedIds.length === 0) {
    return { processed: 0, failed: 0, total: 0, pollAccepted: 0 };
  }

  console.log(`[OutreachTick] Claimed ${claimedIds.length} threads`);

  let processed = 0;
  let failed = 0;

  for (const threadId of claimedIds) {
    try {
      await processThread(threadId);
      processed++;
    } catch (err: any) {
      console.error(`[OutreachTick] Thread ${threadId} failed: ${err.message}`);
      failed++;
      await prisma.channelThread
        .updateMany({
          where: {
            id: threadId,
            status: { in: ["PENDING", "ACTIVE"] },
          },
          data: { nextActionAt: new Date(Date.now() + RETRY_DELAY_MS) },
        })
        .catch(e => console.error(`[OutreachTick] Failed to reset thread ${threadId}:`, e.message));
    }
  }

  console.log(`[OutreachTick] Done — processed=${processed} failed=${failed}`);

  const pollAccepted = await pollInviteAcceptances();
  const pollReplied = await pollChatReplies();

  return { processed, failed, total: claimedIds.length, pollAccepted };
}

async function pollInviteAcceptances(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const pendingThreads = await prisma.channelThread.findMany({
    where: {
      status: "ACTIVE",
      providerState: { path: ["phase"], equals: "INVITE_PENDING" },
      inviteSentAt: { lt: oneHourAgo },
    },
    select: {
      id: true,
      taskId: true,
      task: { select: { result: true } },
      channel: {
        select: {
          sendingAccount: { select: { accountId: true, dsn: true, apiKey: true } },
        },
      },
    },
  });

  if (pendingThreads.length === 0) return 0;

  const byAccount = new Map<string, typeof pendingThreads>();
  for (const t of pendingThreads) {
    const acc = t.channel.sendingAccount;
    if (!acc) continue;
    const bucket = byAccount.get(acc.accountId) ?? [];
    bucket.push(t);
    byAccount.set(acc.accountId, bucket);
  }

  let accepted = 0;

  for (const [, threads] of byAccount) {
    const acc = threads[0].channel.sendingAccount!;
    const sentInvites = await listSentInvitations({
      accountId: acc.accountId,
      limit: 200,
      accountDsn: acc.dsn ?? undefined,
      accountApiKey: acc.apiKey ?? undefined,
    });

    const sentProviderIds = new Set(sentInvites.map(i => i.invitedUserId).filter(Boolean) as string[]);
    const sentPublicIds = new Set(sentInvites.map(i => i.invitedUserPublicId).filter(Boolean) as string[]);

    for (const thread of threads) {
      try {
        const profile = thread.task.result ? JSON.parse(thread.task.result as string) : null;
        const pid: string | undefined = profile?.provider_id;
        const pubId: string | undefined = profile?.public_identifier;

        const stillPending = (pid && sentProviderIds.has(pid)) || (pubId && sentPublicIds.has(pubId));
        if (stillPending) continue;

        const current = await prisma.channelThread.findUnique({
          where: { id: thread.id },
          select: { providerState: true },
        });
        const phase = (current?.providerState as Record<string, string> | null)?.phase;
        if (phase !== "INVITE_PENDING") continue;

        await prisma.channelThread.update({
          where: { id: thread.id },
          data: {
            providerState: { phase: "CONNECTED" },
            nextActionAt: new Date(),
          },
        });
        await recomputeTaskStage(thread.taskId);
        console.log(`[OutreachTick] pollInviteAcceptances: Thread ${thread.id.slice(-6)} → CONNECTED`);
        accepted++;
      } catch (err: any) {
        console.warn(`[OutreachTick] pollInviteAcceptances: error for thread ${thread.id}: ${err.message}`);
      }
    }
  }

  if (accepted > 0) {
    console.log(`[OutreachTick] pollInviteAcceptances: ${accepted} newly accepted`);
  }
  return accepted;
}

// ─── Reply polling ────────────────────────────────────────────────────────────
//
// Fallback for missed/delayed webhooks. For every ACTIVE thread that has a
// providerChatId (DM/InMail/WA sent), fetch the last few messages from Unipile
// and check if any inbound message arrived after our last outbound send.
//
// Runs on every outreach tick. Skips threads where webhook already fired
// (status would already be REPLIED).

async function pollChatReplies(): Promise<number> {
  const activeThreadsWithChat = await prisma.channelThread.findMany({
    where: {
      status: "ACTIVE",
      providerChatId: { not: null },
      lastMessageAt: { not: null },
    },
    select: {
      id: true,
      taskId: true,
      providerChatId: true,
      lastMessageAt: true,
      channel: {
        select: {
          sendingAccount: { select: { accountId: true, dsn: true, apiKey: true } },
        },
      },
    },
  });

  if (activeThreadsWithChat.length === 0) return 0;

  let replied = 0;

  for (const thread of activeThreadsWithChat) {
    try {
      const acc = thread.channel.sendingAccount;
      if (!acc || !thread.providerChatId) continue;

      const messages = await listChatMessages({
        chatId: thread.providerChatId,
        accountId: acc.accountId,
        limit: 5,
        accountDsn: acc.dsn ?? undefined,
        accountApiKey: acc.apiKey ?? undefined,
      });

      // Check if any message is inbound (not from us) and newer than our last sent message
      const lastSentAt = thread.lastMessageAt!;
      const hasReply = messages.some(
        m => !m.fromMe && new Date(m.date) > lastSentAt,
      );

      if (hasReply) {
        await markThreadReplied(thread.id, thread.taskId);
        await recomputeTaskStage(thread.taskId);
        console.log(`[OutreachTick] pollChatReplies: Thread ${thread.id.slice(-6)} → REPLIED`);
        replied++;
      }
    } catch (err: any) {
      console.warn(`[OutreachTick] pollChatReplies: error for thread ${thread.id}: ${err.message}`);
    }
  }

  if (replied > 0) {
    console.log(`[OutreachTick] pollChatReplies: ${replied} new replies detected`);
  }
  return replied;
}

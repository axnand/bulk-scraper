// ─── Outreach tick — the single scheduler for all ChannelThreads ──────────────
//
// Runs every 60s (configure in vercel.json or your cron provider).
// Uses "UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)" to atomically
// claim due threads. Safe to run multiple instances concurrently — SKIP LOCKED
// ensures each thread is processed by exactly one worker.
//
// Flow per tick:
//   1. Claim up to MAX_PER_TICK threads whose nextActionAt has passed
//   2. Process each via processThread() — one API call per thread
//   3. On error: reset nextActionAt to +RETRY_DELAY_MS for automatic retry
//   4. Recompute task stage after any thread state change (done inside processThread)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processThread } from "@/lib/channels/thread-worker";
import { listSentInvitations } from "@/lib/services/unipile.service";
import { recomputeTaskStage } from "@/lib/channels/stage-rollup";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_PER_TICK = 200;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes on error

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Atomically claim due threads and clear their nextActionAt so concurrent
  // cron runs don't double-process them. The claimed rows are returned.
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
    return NextResponse.json({ error: "Failed to claim threads" }, { status: 500 });
  }

  if (claimedIds.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0 });
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
      // Reset nextActionAt so this thread gets retried after RETRY_DELAY_MS
      await prisma.channelThread
        .updateMany({
          where: {
            id: threadId,
            status: { in: ["PENDING", "ACTIVE"] }, // don't reset if archived/replied
          },
          data: { nextActionAt: new Date(Date.now() + RETRY_DELAY_MS) },
        })
        .catch(e => console.error(`[OutreachTick] Failed to reset thread ${threadId}:`, e.message));
    }
  }

  console.log(`[OutreachTick] Done — processed=${processed} failed=${failed}`);

  // Poll for accepted invitations as a fallback for missed webhooks (new_relation can lag)
  const pollAccepted = await pollInviteAcceptances();

  return NextResponse.json({ processed, failed, total: claimedIds.length, pollAccepted });
}

// ─── Invite acceptance polling ────────────────────────────────────────────────
//
// The new_relation webhook can lag up to 8 hours. This function queries
// INVITE_PENDING threads older than 1 hour and checks whether they still
// appear in the account's sent-invitations list. If an invite was accepted,
// Unipile removes it from that list — we then transition the thread to CONNECTED
// so the cron can send the first DM on the next tick.

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
          sendingAccount: {
            select: { accountId: true, dsn: true, apiKey: true },
          },
        },
      },
    },
  });

  if (pendingThreads.length === 0) return 0;

  // Group by account to minimise API calls
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
        if (stillPending) continue; // invite not yet accepted

        // Not in sent list → treat as accepted (webhook missed or lagged)
        const current = await prisma.channelThread.findUnique({
          where: { id: thread.id },
          select: { providerState: true },
        });
        const phase = (current?.providerState as Record<string, string> | null)?.phase;
        if (phase !== "INVITE_PENDING") continue; // already handled by webhook

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

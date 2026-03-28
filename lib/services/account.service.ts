import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/lib/config";

type Account = Awaited<ReturnType<typeof prisma.account.update>>;

/**
 * Reset expired minute-rate-limit windows and daily counters.
 * Also refreshes expired cooldowns back to ACTIVE.
 * Call once at the start of each processing cycle.
 */
async function resetExpiredWindows() {
  const now = new Date();

  await Promise.all([
    // Reset minute counters where the window has expired
    prisma.account.updateMany({
      where: { minuteResetAt: { lt: now }, minuteCount: { gt: 0 } },
      data: { minuteCount: 0, minuteResetAt: null },
    }),
    // Reset daily counters where the day has expired
    prisma.account.updateMany({
      where: { dailyResetAt: { lt: now }, dailyCount: { gt: 0 } },
      data: { dailyCount: 0, dailyResetAt: null },
    }),
    // Refresh expired cooldowns
    prisma.account.updateMany({
      where: { status: "COOLDOWN", cooldownUntil: { lt: now } },
      data: { status: "ACTIVE", cooldownUntil: null },
    }),
  ]);
}

/**
 * Acquire up to `count` accounts from the pool.
 * Uses optimistic locking — only claims accounts still marked ACTIVE.
 */
export async function acquireAccounts(count: number = 1): Promise<Account[]> {
  await resetExpiredWindows();

  const now = new Date();
  const candidates = await prisma.account.findMany({
    where: {
      status: "ACTIVE",
      dailyCount: { lt: CONFIG.DAILY_SAFE_LIMIT },
      minuteCount: { lt: CONFIG.MAX_REQUESTS_PER_MINUTE },
      OR: [
        { cooldownUntil: null },
        { cooldownUntil: { lt: now } },
      ],
    },
    orderBy: [
      { dailyCount: "asc" },
      { lastUsedAt: "asc" },
    ],
    take: count + 5, // extra candidates for optimistic locking failures
  });

  const acquired: Account[] = [];
  for (const candidate of candidates) {
    if (acquired.length >= count) break;
    try {
      const acct = await prisma.account.update({
        where: { id: candidate.id, status: "ACTIVE" },
        data: { status: "BUSY" },
      });
      acquired.push(acct);
    } catch {
      // Another invocation grabbed it — try next
      continue;
    }
  }

  return acquired;
}

/**
 * Convenience wrapper: acquire a single account or null.
 */
export async function acquireAccount(): Promise<Account | null> {
  const accounts = await acquireAccounts(1);
  return accounts[0] ?? null;
}

/**
 * Release an account back to the pool after processing.
 * Increments both daily and per-minute counters.
 */
export async function releaseAccount(id: string, success: boolean) {
  const now = new Date();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const oneMinuteFromNow = new Date(now.getTime() + 60_000);

  try {
    await prisma.account.update({
      where: { id },
      data: {
        status: "ACTIVE",
        requestCount: { increment: 1 },
        dailyCount: { increment: 1 },
        minuteCount: { increment: 1 },
        lastUsedAt: now,
        dailyResetAt: endOfDay,
        minuteResetAt: oneMinuteFromNow,
      },
    });
  } catch (error) {
    console.error(`[AccountService] Failed to release account ${id}:`, error);
  }
}

/**
 * Put an account into cooldown (e.g. after a 429 response).
 */
export async function cooldownAccount(id: string) {
  const cooldownUntil = new Date(Date.now() + CONFIG.COOLDOWN_DURATION_MS);
  console.log(
    `[AccountService] Cooling down account ${id} until ${cooldownUntil.toISOString()}`
  );

  try {
    await prisma.account.update({
      where: { id },
      data: { status: "COOLDOWN", cooldownUntil },
    });
  } catch (error) {
    console.error(`[AccountService] Failed to cooldown account ${id}:`, error);
  }
}

/**
 * Refresh all expired cooldowns (called by resetExpiredWindows, but
 * exported for the safety-net cron).
 */
export async function refreshCooldowns() {
  const now = new Date();
  const result = await prisma.account.updateMany({
    where: { status: "COOLDOWN", cooldownUntil: { lt: now } },
    data: { status: "ACTIVE", cooldownUntil: null },
  });
  if (result.count > 0) {
    console.log(
      `[AccountService] Refreshed ${result.count} accounts from cooldown`
    );
  }
}

/**
 * Get all accounts with their current stats (for monitoring).
 */
export async function getAccountStats() {
  return prisma.account.findMany({
    select: {
      id: true,
      accountId: true,
      name: true,
      dsn: true,
      apiKey: true,
      status: true,
      requestCount: true,
      dailyCount: true,
      dailyResetAt: true,
      minuteCount: true,
      minuteResetAt: true,
      cooldownUntil: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Recover stuck state: reset BUSY accounts with no PROCESSING tasks,
 * and reset stale PROCESSING tasks back to PENDING.
 */
export async function recoverStaleState() {
  const staleThreshold = new Date(Date.now() - CONFIG.STALE_TASK_MS);

  // Reset tasks stuck in PROCESSING for too long
  const staleTasks = await prisma.task.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: staleThreshold },
    },
    data: { status: "PENDING", accountId: null },
  });

  // Reset BUSY accounts that have no PROCESSING tasks assigned
  const busyAccounts = await prisma.account.findMany({
    where: { status: "BUSY" },
    select: { id: true },
  });

  for (const acct of busyAccounts) {
    const processingCount = await prisma.task.count({
      where: { accountId: acct.id, status: "PROCESSING" },
    });
    if (processingCount === 0) {
      await prisma.account.update({
        where: { id: acct.id, status: "BUSY" },
        data: { status: "ACTIVE" },
      }).catch(() => {}); // optimistic — may already be released
    }
  }

  if (staleTasks.count > 0) {
    console.log(`[AccountService] Recovered ${staleTasks.count} stale tasks`);
  }

  return { recoveredTasks: staleTasks.count, checkedAccounts: busyAccounts.length };
}

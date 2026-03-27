import { prisma } from "@/lib/prisma";
import { CONFIG } from "@/lib/config";

/**
 * Acquire a free account from the pool.
 * Uses optimistic locking: only updates if status is still ACTIVE.
 * Returns the account or null if none available.
 */
export async function acquireAccount() {
  // 1. Reset dailyCount for accounts whose dailyResetAt has expired
  const now = new Date();
  await prisma.account.updateMany({
    where: {
      dailyResetAt: { lt: now },
      dailyCount: { gt: 0 },
    },
    data: {
      dailyCount: 0,
      dailyResetAt: null,
    },
  });

  // 2. Refresh cooldowns — move expired cooldowns back to ACTIVE
  await prisma.account.updateMany({
    where: {
      status: "COOLDOWN",
      cooldownUntil: { lt: now },
    },
    data: {
      status: "ACTIVE",
      cooldownUntil: null,
    },
  });

  // 3. Find eligible accounts
  const candidates = await prisma.account.findMany({
    where: {
      status: "ACTIVE",
      dailyCount: { lt: CONFIG.DAILY_SAFE_LIMIT },
      OR: [
        { cooldownUntil: null },
        { cooldownUntil: { lt: now } },
      ],
    },
    orderBy: [
      { dailyCount: "asc" },    // lowest usage first
      { lastUsedAt: "asc" },    // oldest used first
    ],
    take: 5, // get a few candidates for optimistic locking
  });

  if (candidates.length === 0) return null;

  // 4. Try to atomically claim one (optimistic lock)
  for (const candidate of candidates) {
    try {
      const acquired = await prisma.account.update({
        where: {
          id: candidate.id,
          status: "ACTIVE", // only succeeds if still ACTIVE
        },
        data: {
          status: "BUSY",
        },
      });
      return acquired;
    } catch {
      // Another worker grabbed it — try the next candidate
      continue;
    }
  }

  return null;
}

/**
 * Release an account back to the pool after processing.
 */
export async function releaseAccount(id: string, success: boolean) {
  const now = new Date();

  // Set dailyResetAt to end of current day if not already set
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  try {
    await prisma.account.update({
      where: { id },
      data: {
        status: "ACTIVE",
        requestCount: { increment: 1 },
        dailyCount: { increment: 1 },
        lastUsedAt: now,
        dailyResetAt: endOfDay,
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
  console.log(`[AccountService] Cooling down account ${id} until ${cooldownUntil.toISOString()}`);

  try {
    await prisma.account.update({
      where: { id },
      data: {
        status: "COOLDOWN",
        cooldownUntil,
      },
    });
  } catch (error) {
    console.error(`[AccountService] Failed to cooldown account ${id}:`, error);
  }
}

/**
 * Refresh all expired cooldowns (run periodically).
 */
export async function refreshCooldowns() {
  const now = new Date();
  const result = await prisma.account.updateMany({
    where: {
      status: "COOLDOWN",
      cooldownUntil: { lt: now },
    },
    data: {
      status: "ACTIVE",
      cooldownUntil: null,
    },
  });
  if (result.count > 0) {
    console.log(`[AccountService] Refreshed ${result.count} accounts from cooldown`);
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
      status: true,
      requestCount: true,
      dailyCount: true,
      dailyResetAt: true,
      cooldownUntil: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

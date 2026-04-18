import { prisma } from "./prisma";

export const CONFIG = {
  // Rate limiting per account
  MAX_REQUESTS_PER_MINUTE: 10,
  DAILY_SAFE_LIMIT: 100,

  // Anti-detection jitter (random delay before each API call)
  JITTER_MIN_MS: 200,
  JITTER_MAX_MS: 800,

  // Cooldown on 429 (15 minutes)
  COOLDOWN_DURATION_MS: 15 * 60 * 1000,

  // Retry settings
  MAX_RETRIES: 3,

  // Stale task threshold (2 minutes — cron fires every 1 min, so recovery happens within ~2 ticks)
  STALE_TASK_MS: 2 * 60 * 1000,

  // Task/Job cleanup after completion (48 hours)
  TASK_CLEANUP_MS: 48 * 60 * 60 * 1000,

  // Raw profile retention — 0 means keep forever (set via DATA_RETENTION_DAYS env var)
  get DATA_RETENTION_DAYS(): number {
    return parseInt(process.env.DATA_RETENTION_DAYS || "0", 10);
  },
};

/**
 * Get dynamic concurrency based on available accounts.
 * Returns the number of accounts that can process tasks right now.
 */
export async function getWorkerConcurrency(): Promise<number> {
  try {
    const now = new Date();
    const activeCount = await prisma.account.count({
      where: {
        status: "ACTIVE",
        dailyCount: { lt: CONFIG.DAILY_SAFE_LIMIT },
        minuteCount: { lt: CONFIG.MAX_REQUESTS_PER_MINUTE },
        OR: [
          { cooldownUntil: null },
          { cooldownUntil: { lt: now } },
        ],
      },
    });
    return Math.max(1, Math.min(activeCount, 10));
  } catch {
    return 3;
  }
}

/**
 * Sleep for a random jitter duration (anti-detection).
 */
export function jitter(): Promise<void> {
  const ms =
    CONFIG.JITTER_MIN_MS +
    Math.random() * (CONFIG.JITTER_MAX_MS - CONFIG.JITTER_MIN_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

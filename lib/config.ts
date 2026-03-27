export const CONFIG = {
  // Rate limiting per account
  MAX_REQUESTS_PER_MINUTE: 10,
  DAILY_SAFE_LIMIT: 100,

  // Anti-detection jitter (random delay before each API call)
  JITTER_MIN_MS: 500,
  JITTER_MAX_MS: 1500,

  // Cooldown on 429 (15 minutes)
  COOLDOWN_DURATION_MS: 15 * 60 * 1000,

  // Retry settings
  MAX_RETRIES: 3,

  // Worker concurrency (parallel tasks per worker process)
  WORKER_CONCURRENCY: 3,

  // Requeue delay when no account available (30 seconds)
  REQUEUE_DELAY_MS: 30 * 1000,
};

import { connection } from "@/lib/queue";
import { CONFIG } from "@/lib/config";

const RATE_KEY_PREFIX = "rate:";
const WINDOW_SECONDS = 60;

/**
 * Check if an account is within its rate limit.
 * Returns { allowed, retryAfterMs }.
 */
export async function checkRateLimit(accountId: string): Promise<{
  allowed: boolean;
  retryAfterMs?: number;
}> {
  const key = `${RATE_KEY_PREFIX}${accountId}`;
  const current = await connection.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= CONFIG.MAX_REQUESTS_PER_MINUTE) {
    const ttl = await connection.ttl(key);
    const retryAfterMs = (ttl > 0 ? ttl : WINDOW_SECONDS) * 1000;
    return { allowed: false, retryAfterMs };
  }

  return { allowed: true };
}

/**
 * Record a request for rate-limiting purposes.
 * Increments the counter with a sliding TTL window.
 */
export async function recordRequest(accountId: string): Promise<void> {
  const key = `${RATE_KEY_PREFIX}${accountId}`;
  const multi = connection.multi();
  multi.incr(key);
  multi.expire(key, WINDOW_SECONDS);
  await multi.exec();
}

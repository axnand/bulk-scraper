import { PgBoss } from "pg-boss";

let instance: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!instance) throw new Error("pg-boss not started. Call startBoss() first.");
  return instance;
}

export async function startBoss(): Promise<PgBoss> {
  if (instance) return instance; // idempotent — safe to call from both web and worker processes

  const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL or DIRECT_DATABASE_URL must be set");

  // Strip sslmode from the URL so our ssl option isn't overridden.
  // pg-connection-string v2.6+ treats sslmode=require as verify-full,
  // which rejects self-signed certs on Railway/Supabase/Neon.
  let cleanedUrl = connectionString;
  try {
    const u = new URL(connectionString);
    u.searchParams.delete("sslmode");
    cleanedUrl = u.toString();
  } catch { /* not a parseable URL, use as-is */ }

  instance = new PgBoss({
    connectionString: cleanedUrl,
    ssl: { rejectUnauthorized: false },
    // Dedicated pool for pg-boss internals — separate from Prisma's pool.
    // Keep this low: Supabase PgBouncer Session mode has a hard pool_size limit
    // (15 on free tier). Budget: pg-boss=3 + Prisma worker slots=5 → total 8.
    max: 3,
  });

  instance.on("error", (err: Error) => console.error("[pg-boss] Error:", err));

  await instance.start();

  // Set retry/expiry config at the queue level (pg-boss v12 pattern)
  await instance.createQueue("process-task", {
    retryLimit: 3,
    retryDelay: 30,       // seconds; doubles each retry with backoff: 30s, 60s, 120s
    retryBackoff: true,
    expireInSeconds: 300, // 5 min — job stuck beyond this gets retried automatically
    deleteAfterSeconds: 86400,
  });

  await instance.createQueue("process-resume-task", {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deleteAfterSeconds: 86400,
  });

  console.log("[pg-boss] Started");
  return instance;
}

export async function stopBoss(): Promise<void> {
  if (instance) {
    await instance.stop({ graceful: true, timeout: 25000 });
    console.log("[pg-boss] Stopped");
    instance = null;
  }
}

export function getQueueName(source: string): "process-task" | "process-resume-task" {
  return source === "linkedin_url" ? "process-task" : "process-resume-task";
}

// ─── Web-process enqueue via Prisma raw SQL ────────────────────────
//
// Instead of starting a full pg-boss instance (which opens its own
// connection pool and supervisor loop), we insert jobs directly into
// the pgboss.job table using Prisma's existing connection.
//
// This mirrors pg-boss v12's insertJobs() query: it joins against
// pgboss.queue to inherit retry/expiry/deletion config set by
// startBoss() in the worker process.
//
// The worker's pg-boss instance picks up these rows automatically.

import { prisma } from "@/lib/prisma";

async function enqueueToQueue(
  queueName: "process-task" | "process-resume-task",
  jobs: Array<{ data: Record<string, unknown> }>,
): Promise<void> {
  if (jobs.length === 0) return;

  // Build the JSON array that pg-boss's json_to_recordset expects
  const jobArray = JSON.stringify(jobs.map(j => ({ data: j.data })));

  await prisma.$executeRawUnsafe(`
    INSERT INTO pgboss.job (
      id, name, data, priority, start_after,
      expire_seconds, deletion_seconds, keep_until,
      retry_limit, retry_delay, retry_backoff, retry_delay_max,
      policy, dead_letter, heartbeat_seconds
    )
    SELECT
      gen_random_uuid(),
      $2,
      j.data,
      0,
      now(),
      q.expire_seconds,
      q.deletion_seconds,
      now() + (q.retention_seconds * interval '1s'),
      q.retry_limit,
      q.retry_delay,
      COALESCE(q.retry_backoff, false),
      q.retry_delay_max,
      q.policy,
      q.dead_letter,
      q.heartbeat_seconds
    FROM json_to_recordset($1::json) AS j (data jsonb)
    JOIN pgboss.queue q ON q.name = $2
  `, jobArray, queueName);
}

export async function enqueueTaskBatch(
  tasks: Array<{ id: string; source: string }>
): Promise<void> {
  if (tasks.length === 0) return;

  const linkedIn = tasks
    .filter((t) => t.source === "linkedin_url")
    .map((t) => ({ data: { taskId: t.id } }));

  const resume = tasks
    .filter((t) => t.source !== "linkedin_url")
    .map((t) => ({ data: { taskId: t.id } }));

  await Promise.all([
    linkedIn.length > 0 ? enqueueToQueue("process-task", linkedIn) : Promise.resolve(),
    resume.length > 0 ? enqueueToQueue("process-resume-task", resume) : Promise.resolve(),
  ]);
}

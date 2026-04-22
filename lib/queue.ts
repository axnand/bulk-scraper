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
    // Dedicated pool for pg-boss internals — keeps it from competing with Prisma connections.
    // Set Prisma connection_limit=10 in DATABASE_URL to cap Prisma's side.
    max: 5,
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

export async function enqueueTaskBatch(
  tasks: Array<{ id: string; source: string }>
): Promise<void> {
  if (tasks.length === 0) return;
  const b = await startBoss(); // lazy init — works in both web and worker processes

  const linkedIn = tasks
    .filter((t) => t.source === "linkedin_url")
    .map((t) => ({ data: { taskId: t.id } }));

  const resume = tasks
    .filter((t) => t.source !== "linkedin_url")
    .map((t) => ({ data: { taskId: t.id } }));

  await Promise.all([
    linkedIn.length > 0 ? b.insert("process-task", linkedIn) : Promise.resolve(),
    resume.length > 0 ? b.insert("process-resume-task", resume) : Promise.resolve(),
  ]);
}

import { startBoss, stopBoss, getBoss } from "@/lib/queue";
import { handleLinkedInJobs, handleResumeJobs } from "@/lib/workers/task-handlers";

async function main() {
  console.log("[Worker] Starting...");

  const boss = await startBoss();

  await boss.work<{ taskId: string }>(
    "process-task",
    { localConcurrency: 10, includeMetadata: true },
    handleLinkedInJobs as any
  );

  await boss.work<{ taskId: string }>(
    "process-resume-task",
    { localConcurrency: 5, includeMetadata: true },
    handleResumeJobs as any
  );

  console.log("[Worker] Ready. Listening for jobs...");

  // Log queue depth every 60 seconds
  setInterval(async () => {
    try {
      const b = getBoss();
      const [li, resume] = await Promise.all([
        b.getQueueStats("process-task").catch(() => null),
        b.getQueueStats("process-resume-task").catch(() => null),
      ]);
      console.log(
        `[Worker] process-task: queued=${li?.queuedCount ?? "?"} active=${li?.activeCount ?? "?"} | ` +
        `process-resume-task: queued=${resume?.queuedCount ?? "?"} active=${resume?.activeCount ?? "?"}`
      );
    } catch { /* non-fatal */ }
  }, 60_000);

  const shutdown = async (signal: string) => {
    console.log(`[Worker] ${signal} received — shutting down gracefully...`);
    await stopBoss();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Keep process alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[Worker] Fatal error:", err);
  process.exit(1);
});

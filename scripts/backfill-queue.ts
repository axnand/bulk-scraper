/**
 * One-time backfill: enqueue all existing PENDING tasks into pg-boss.
 * Run once during the first deploy: tsx scripts/backfill-queue.ts
 */
import { prisma } from "@/lib/prisma";
import { startBoss, stopBoss, enqueueTaskBatch } from "@/lib/queue";

async function run() {
  console.log("[Backfill] Starting...");

  await startBoss();

  const pendingTasks = await prisma.task.findMany({
    where: { status: "PENDING" },
    select: { id: true, source: true },
  });

  console.log(`[Backfill] Found ${pendingTasks.length} PENDING tasks to enqueue.`);

  if (pendingTasks.length === 0) {
    console.log("[Backfill] Nothing to do.");
    await stopBoss();
    await prisma.$disconnect();
    return;
  }

  const CHUNK = 500;
  for (let i = 0; i < pendingTasks.length; i += CHUNK) {
    const chunk = pendingTasks.slice(i, i + CHUNK);
    await enqueueTaskBatch(chunk);
    console.log(`[Backfill] Enqueued ${Math.min(i + CHUNK, pendingTasks.length)}/${pendingTasks.length}`);
  }

  console.log("[Backfill] Done.");
  await stopBoss();
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error("[Backfill] Error:", err);
  process.exit(1);
});

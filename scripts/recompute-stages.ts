/**
 * One-shot script: recompute task.stage for every task that has ChannelThreads.
 * Run with:  npx tsx scripts/recompute-stages.ts
 *
 * Safe to run multiple times — recomputeTaskStage is idempotent.
 */
import { prisma } from "@/lib/prisma";
import { recomputeTaskStage } from "@/lib/channels/stage-rollup";

async function main() {
  const tasks = await prisma.task.findMany({
    where: { channelThreads: { some: {} } },
    select: { id: true, stage: true },
  });

  console.log(`Recomputing stages for ${tasks.length} tasks with threads...`);

  let changed = 0;
  let errors = 0;

  for (const task of tasks) {
    try {
      const newStage = await recomputeTaskStage(task.id);
      if (newStage !== task.stage) {
        console.log(`  ${task.id.slice(-6)} ${task.stage} → ${newStage}`);
        changed++;
      }
    } catch (err: any) {
      console.error(`  ${task.id.slice(-6)} ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. changed=${changed} errors=${errors} unchanged=${tasks.length - changed - errors}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

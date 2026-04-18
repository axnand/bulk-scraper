import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recoverStaleState, refreshCooldowns } from "@/lib/services/account.service";
import { triggerProcessing } from "@/lib/trigger";
import { CONFIG } from "@/lib/config";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Safety-net cron — runs every 15 minutes.
 *
 * 1. Recovers stale PROCESSING tasks and stuck BUSY accounts
 * 2. Refreshes expired cooldowns
 * 3. If any PENDING tasks exist, triggers the self-chaining processor
 *
 * The primary processing path is the after() chain triggered on job creation.
 * This cron exists only as a fallback for broken chains (deploys, crashes, etc).
 */
export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron Safety Net] Running health check...");

  try {
    // Snapshot task state BEFORE recovery so we can see what was stuck
    const [pendingBefore, processingBefore, doneBefore, failedBefore] = await Promise.all([
      prisma.task.count({ where: { status: "PENDING" } }),
      prisma.task.count({ where: { status: "PROCESSING" } }),
      prisma.task.count({ where: { status: "DONE" } }),
      prisma.task.count({ where: { status: "FAILED" } }),
    ]);
    console.log(
      `[Cron Safety Net] Task state BEFORE recovery: PENDING=${pendingBefore} PROCESSING=${processingBefore} DONE=${doneBefore} FAILED=${failedBefore}`
    );

    // 1. Recover stale state
    const recovery = await recoverStaleState();

    // 2. Refresh cooldowns
    await refreshCooldowns();

    // 3. Clean up completed/failed jobs older than 48 hours
    const cutoff = new Date(Date.now() - CONFIG.TASK_CLEANUP_MS);
    const staleJobs = await prisma.job.findMany({
      where: {
        status: { in: ["COMPLETED", "FAILED"] },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
    });

    let cleanedTasks = 0;
    if (staleJobs.length > 0) {
      const jobIds = staleJobs.map((j) => j.id);
      const deleted = await prisma.task.deleteMany({
        where: { jobId: { in: jobIds } },
      });
      cleanedTasks = deleted.count;

      // Delete the job rows too
      await prisma.job.deleteMany({
        where: { id: { in: jobIds } },
      });

      console.log(
        `[Cron Safety Net] Cleaned up ${staleJobs.length} old jobs, ${cleanedTasks} tasks`
      );
    }

    // 4. Optional: clear raw profiles older than DATA_RETENTION_DAYS to save storage
    let clearedProfiles = 0;
    const retentionDays = CONFIG.DATA_RETENTION_DAYS;
    if (retentionDays > 0) {
      const profileCutoff = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000
      );
      const cleared = await prisma.candidateProfile.updateMany({
        where: {
          scrapedAt: { lt: profileCutoff },
          rawProfile: { not: null },
        },
        data: { rawProfile: null },
      });
      clearedProfiles = cleared.count;
      if (clearedProfiles > 0) {
        console.log(
          `[Cron Safety Net] Cleared rawProfile from ${clearedProfiles} old candidate records`
        );
      }
    }

    // 5. Check for pending/stuck tasks and re-trigger if needed
    const pendingCount = await prisma.task.count({
      where: { status: "PENDING" },
    });

    // Tasks stuck in PROCESSING for > 2 min (before they hit the 5-min stale threshold)
    // This catches cases where the Vercel function was killed mid-flight but tasks haven't
    // aged enough to be reset by recoverStaleState yet
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const stuckProcessingCount = await prisma.task.count({
      where: { status: "PROCESSING", updatedAt: { lt: twoMinutesAgo } },
    });

    const [pendingAfter, processingAfter] = await Promise.all([
      prisma.task.count({ where: { status: "PENDING" } }),
      prisma.task.count({ where: { status: "PROCESSING" } }),
    ]);
    console.log(
      `[Cron Safety Net] Task state AFTER recovery: PENDING=${pendingAfter} PROCESSING=${processingAfter} | stuckProcessing(>2min)=${stuckProcessingCount}`
    );

    const shouldTrigger = pendingCount > 0 || stuckProcessingCount > 0;
    if (shouldTrigger) {
      console.log(
        `[Cron Safety Net] Triggering processor — pendingCount=${pendingCount} stuckProcessingCount=${stuckProcessingCount}`
      );
      await triggerProcessing();
    } else {
      console.log(
        `[Cron Safety Net] No work to do — pendingCount=${pendingCount} processingAfter=${processingAfter} (in-flight, healthy)`
      );
    }

    return NextResponse.json({
      message: "Safety net check complete",
      pendingCount,
      stuckProcessingCount,
      recoveredTasks: recovery.recoveredTasks,
      checkedAccounts: recovery.checkedAccounts,
      cleanedJobs: staleJobs.length,
      cleanedTasks,
      clearedProfiles,
    });
  } catch (error) {
    console.error("[Cron Safety Net] Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

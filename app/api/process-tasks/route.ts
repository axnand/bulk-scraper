import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { CONFIG, jitter, getWorkerConcurrency } from "@/lib/config";
import {
  acquireAccounts,
  releaseAccount,
  cooldownAccount,
  recoverStaleState,
} from "@/lib/services/account.service";
import {
  fetchProfile,
  extractIdentifier,
  RateLimitError,
  ServerError,
  ClientError,
  NetworkError,
} from "@/lib/services/unipile.service";
import { analyzeProfile, type AnalysisConfig } from "@/lib/analyzer";
import { exportToSheet, buildSheetPayload } from "@/lib/sheets";
import { triggerProcessing } from "@/lib/trigger";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ─── Helpers ────────────────────────────────────────────────────────

async function getJobConfig(jobId: string): Promise<AnalysisConfig | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { config: true },
  });
  if (job?.config) {
    try {
      return JSON.parse(job.config) as AnalysisConfig;
    } catch {
      return null;
    }
  }
  return null;
}

async function markTaskFailed(
  taskId: string,
  jobId: string,
  errorMessage: string
) {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "FAILED", errorMessage },
  });

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      processedCount: { increment: 1 },
      failedCount: { increment: 1 },
    },
  });

  if (updatedJob.processedCount >= updatedJob.totalTasks) {
    const finalStatus =
      updatedJob.successCount > 0 ? "COMPLETED" : "FAILED";
    await prisma.job.update({
      where: { id: jobId },
      data: { status: finalStatus },
    });
  }
}

/**
 * Process a single task with an assigned account.
 * Returns true if the task was successfully claimed and processed.
 */
async function processOneTask(
  task: {
    id: string;
    url: string;
    jobId: string;
    retryCount: number;
    job: { status: string; id: string };
  },
  account: { id: string; accountId: string; dsn: string | null; apiKey: string | null }
): Promise<void> {
  // Optimistic claim — only succeeds if task is still PENDING
  const claimed = await prisma.task
    .update({
      where: { id: task.id, status: "PENDING" },
      data: { status: "PROCESSING", accountId: account.id },
    })
    .catch(() => null);

  if (!claimed) {
    // Another invocation grabbed this task
    await releaseAccount(account.id, false);
    return;
  }

  // Skip if parent job is cancelled
  if (task.job.status === "CANCELLED") {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "FAILED", errorMessage: "Job was cancelled" },
    });
    await releaseAccount(account.id, false);
    return;
  }

  // Mark job as PROCESSING if it's still PENDING
  if (task.job.status === "PENDING") {
    await prisma.job
      .update({
        where: { id: task.job.id, status: "PENDING" },
        data: { status: "PROCESSING" },
      })
      .catch(() => {});
  }

  try {
    // Validate identifier
    const identifier = extractIdentifier(task.url);
    if (!identifier) {
      await markTaskFailed(task.id, task.jobId, "Invalid LinkedIn URL format");
      await releaseAccount(account.id, false);
      return;
    }

    // Anti-detection jitter
    await jitter();

    // Fetch profile from Unipile
    const profileData = await fetchProfile(
      account.accountId,
      identifier,
      account.dsn || undefined,
      account.apiKey || undefined
    );

    // Save candidate profile (permanent record)
    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        linkedinUrl: task.url,
        name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
        headline: profileData.headline || "",
        location: profileData.location || "",
        rawProfile: JSON.stringify(profileData),
      },
    });

    // AI Analysis phase
    let analysisResultJson: string | null = null;
    const jobConfig = await getJobConfig(task.jobId);

    if (jobConfig?.jobDescription) {
      console.log(`[Process] Running AI analysis for task ${task.id}...`);
      try {
        const analysisResult = await analyzeProfile(profileData, jobConfig);
        analysisResultJson = JSON.stringify(analysisResult);

        // Save analysis record (permanent, never deleted)
        await prisma.analysisRecord.create({
          data: {
            candidateId: candidateProfile.id,
            linkedinUrl: task.url,
            candidateName: analysisResult.candidateInfo?.name || candidateProfile.name,
            jobTitle: (jobConfig as any).jdTitle || "Untitled",
            jobDescription: jobConfig.jobDescription,
            scoringConfig: JSON.stringify({
              scoringRules: jobConfig.scoringRules,
              customScoringRules: jobConfig.customScoringRules,
              aiModel: (jobConfig as any).aiModel,
              customPrompt: jobConfig.customPrompt,
            }),
            analysisData: analysisResultJson,
            totalScore: analysisResult.totalScore,
            maxScore: analysisResult.maxScore,
            scorePercent: analysisResult.scorePercent,
            recommendation: analysisResult.recommendation,
          },
        });

        // Sheet Export
        const sheetUrl = (jobConfig as any).sheetWebAppUrl;
        if (sheetUrl) {
          const minThreshold = (jobConfig as any).minScoreThreshold ?? 0;
          if (analysisResult.scorePercent >= minThreshold) {
            const jdTitle = (jobConfig as any).jdTitle || "Bulk Analysis";
            const payload = buildSheetPayload(
              task.url,
              analysisResult,
              jdTitle,
              jobConfig.scoringRules
            );
            await exportToSheet(sheetUrl, payload);
          }
        }
      } catch (analysisErr: any) {
        console.warn(
          `[Process] Analysis failed for task ${task.id}: ${analysisErr.message}`
        );
      }
    }

    // Mark task as DONE
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "DONE",
        result: JSON.stringify(profileData),
        analysisResult: analysisResultJson,
        accountId: account.id,
      },
    });

    const updatedJob = await prisma.job.update({
      where: { id: task.jobId },
      data: {
        processedCount: { increment: 1 },
        successCount: { increment: 1 },
      },
    });

    if (updatedJob.processedCount >= updatedJob.totalTasks) {
      await prisma.job.update({
        where: { id: task.jobId },
        data: { status: "COMPLETED" },
      });
    }

    await releaseAccount(account.id, true);
  } catch (error: any) {
    // ── Error handling ──
    if (error instanceof RateLimitError) {
      console.warn(`[Process] Account rate limited: ${error.message}`);
      await cooldownAccount(account.id);
      await releaseAccount(account.id, true);
      // Put task back to PENDING for retry
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ServerError || error instanceof NetworkError) {
      console.warn(`[Process] Retryable error: ${error.message}`);
      await releaseAccount(account.id, true);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ClientError) {
      console.error(`[Process] Non-retryable error: ${error.message}`);
      await releaseAccount(account.id, true);
      await markTaskFailed(task.id, task.jobId, error.message);
    } else {
      console.error(`[Process] Unknown error:`, error);
      await releaseAccount(account.id, true);
      if (task.retryCount >= CONFIG.MAX_RETRIES) {
        await markTaskFailed(
          task.id,
          task.jobId,
          `Exhausted retries: ${error.message || "Unknown error"}`
        );
      } else {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "PENDING", retryCount: { increment: 1 } },
        });
      }
    }
  }
}

// ─── Main Route Handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth: reuse CRON_SECRET to secure this internal endpoint
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Process] Starting processing cycle...");

  try {
    // 1. Recover any stale state from prior crashes
    await recoverStaleState();

    // 2. Determine how many tasks we can process in parallel
    const concurrency = await getWorkerConcurrency();

    // 3. Find pending tasks
    const pendingTasks = await prisma.task.findMany({
      where: { status: "PENDING" },
      orderBy: [{ retryCount: "asc" }, { createdAt: "asc" }],
      take: concurrency,
      include: { job: { select: { status: true, id: true } } },
    });

    if (pendingTasks.length === 0) {
      return NextResponse.json({ message: "No pending tasks" });
    }

    // 4. Acquire accounts (one per task)
    const accounts = await acquireAccounts(pendingTasks.length);
    if (accounts.length === 0) {
      console.log("[Process] No accounts available. Will retry via cron.");
      return NextResponse.json({ message: "No accounts available" });
    }

    // 5. Pair tasks with accounts and process in parallel
    const pairs = pendingTasks
      .slice(0, accounts.length)
      .map((task, i) => ({ task, account: accounts[i] }));

    // Release any extra accounts we acquired but won't use
    for (let i = pairs.length; i < accounts.length; i++) {
      await releaseAccount(accounts[i].id, false);
    }

    console.log(
      `[Process] Processing ${pairs.length} tasks in parallel...`
    );

    const results = await Promise.allSettled(
      pairs.map(({ task, account }) => processOneTask(task, account))
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // 6. Check if more pending tasks remain and re-trigger
    const remaining = await prisma.task.count({
      where: { status: "PENDING" },
    });

    if (remaining > 0) {
      console.log(`[Process] ${remaining} tasks remaining, triggering next cycle...`);
      after(async () => {
        await triggerProcessing();
      });
    }

    return NextResponse.json({
      message: "Processing cycle complete",
      processed: pairs.length,
      succeeded,
      failed,
      remaining,
    });
  } catch (error) {
    console.error("[Process] Top-level error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

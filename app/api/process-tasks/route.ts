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
    await releaseAccount(account.id, false);
    return;
  }

  if (task.job.status === "CANCELLED") {
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "FAILED", errorMessage: "Job was cancelled" },
    });
    await releaseAccount(account.id, false);
    return;
  }

  if (task.job.status === "PENDING") {
    await prisma.job
      .update({
        where: { id: task.job.id, status: "PENDING" },
        data: { status: "PROCESSING" },
      })
      .catch(() => {});
  }

  let success = false;
  try {
    const identifier = extractIdentifier(task.url);
    if (!identifier) {
      await markTaskFailed(task.id, task.jobId, "Invalid LinkedIn URL format");
      return;
    }

    await jitter();

    const profileData = await fetchProfile(
      account.accountId,
      identifier,
      account.dsn || undefined,
      account.apiKey || undefined
    );

    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        linkedinUrl: task.url,
        name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
        headline: profileData.headline || "",
        location: profileData.location || "",
        rawProfile: JSON.stringify(profileData),
      },
    });

    let analysisResultJson: string | null = null;
    const jobConfig = await getJobConfig(task.jobId);

    if (jobConfig?.jobDescription) {
      console.log(`[Process] Running AI analysis for task ${task.id}...`);
      try {
        const analysisResult = await analyzeProfile(profileData, jobConfig);
        analysisResultJson = JSON.stringify(analysisResult);

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

    success = true;
  } catch (error: any) {
    if (error instanceof RateLimitError) {
      console.warn(`[Process] Account rate limited: ${error.message}`);
      await cooldownAccount(account.id);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ServerError || error instanceof NetworkError) {
      console.warn(`[Process] Retryable error: ${error.message}`);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ClientError) {
      console.error(`[Process] Non-retryable error: ${error.message}`);
      await markTaskFailed(task.id, task.jobId, error.message);
    } else {
      console.error(`[Process] Unknown error:`, error);
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
  } finally {
    // ALWAYS release the account — prevents accounts stuck in BUSY
    await releaseAccount(account.id, success).catch((err) => {
      console.error(`[Process] Failed to release account ${account.id}:`, err);
    });
  }
}

// ─── Processing Loop (runs inside after(), no HTTP self-calls) ──────

async function runProcessingCycle(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}> {
  await recoverStaleState();

  const concurrency = await getWorkerConcurrency();

  const pendingTasks = await prisma.task.findMany({
    where: { status: "PENDING" },
    orderBy: [{ retryCount: "asc" }, { createdAt: "asc" }],
    take: concurrency,
    include: { job: { select: { status: true, id: true } } },
  });

  if (pendingTasks.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
  }

  const accounts = await acquireAccounts(pendingTasks.length);
  if (accounts.length === 0) {
    const remaining = await prisma.task.count({ where: { status: "PENDING" } });
    return { processed: 0, succeeded: 0, failed: 0, remaining };
  }

  const pairs = pendingTasks
    .slice(0, accounts.length)
    .map((task, i) => ({ task, account: accounts[i] }));

  for (let i = pairs.length; i < accounts.length; i++) {
    await releaseAccount(accounts[i].id, false);
  }

  console.log(`[Process] Processing ${pairs.length} tasks in parallel...`);

  const results = await Promise.allSettled(
    pairs.map(({ task, account }) => processOneTask(task, account))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const remaining = await prisma.task.count({ where: { status: "PENDING" } });

  return { processed: pairs.length, succeeded, failed, remaining };
}

async function processLoop(): Promise<void> {
  const startTime = Date.now();
  const MAX_LOOP_MS = 50000; // Stay under Vercel's 60s limit

  while (Date.now() - startTime < MAX_LOOP_MS) {
    try {
      const result = await runProcessingCycle();
      console.log(
        `[Process] Cycle done: ${result.processed} processed, ${result.remaining} remaining`
      );

      if (result.remaining === 0) {
        console.log("[Process] All tasks done.");
        return;
      }

      if (result.processed === 0) {
        // No accounts available — wait for them to free up
        console.log("[Process] No accounts available, waiting 5s...");
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        // Brief pause for rate-limit windows
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      console.error("[Process] Cycle error:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Ran out of time — check if there's still work
  const remaining = await prisma.task.count({ where: { status: "PENDING" } });
  if (remaining > 0) {
    console.log(
      `[Process] Time limit reached, ${remaining} tasks remaining. Cron will pick up.`
    );
  }
}

// ─── Main Route Handler ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Process] Starting processing...");

  // Run the processing loop in after() so the response returns immediately
  after(async () => {
    await processLoop();
  });

  return NextResponse.json({ message: "Processing started" });
}

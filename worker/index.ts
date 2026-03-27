import { Worker, Job, UnrecoverableError } from "bullmq";
import { connection, QUEUE_NAME, urlQueue } from "../lib/queue";
import { prisma } from "../lib/prisma";
import { CONFIG } from "../lib/config";
import {
  acquireAccount,
  releaseAccount,
  cooldownAccount,
  refreshCooldowns,
} from "../lib/services/account.service";
import { checkRateLimit, recordRequest } from "../lib/services/rate-limiter";
import {
  fetchProfile,
  extractIdentifier,
  RateLimitError,
  ServerError,
  ClientError,
  NetworkError,
} from "../lib/services/unipile.service";
import { analyzeProfile, type AnalysisConfig } from "../lib/analyzer";
import { exportToSheet, buildSheetPayload } from "../lib/sheets";

console.log("[Worker] Starting up...");
console.log(`[Worker] Concurrency: ${CONFIG.WORKER_CONCURRENCY}`);

// ─── Cooldown refresh interval (every 60 seconds) ──────────────────
setInterval(async () => {
  try {
    await refreshCooldowns();
  } catch (err) {
    console.error("[Worker] Error refreshing cooldowns:", err);
  }
}, 60_000);

// ─── Processing data interface ─────────────────────────────────────
interface ProcessingData {
  taskId: string;
  url: string;
  jobId: string;
}

// ─── Utility: random jitter delay ──────────────────────────────────
function jitter(): Promise<void> {
  const ms =
    Math.floor(Math.random() * (CONFIG.JITTER_MAX_MS - CONFIG.JITTER_MIN_MS)) +
    CONFIG.JITTER_MIN_MS;
  console.log(`[Worker] Jitter delay: ${ms}ms`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main worker ───────────────────────────────────────────────────
const worker = new Worker<ProcessingData>(
  QUEUE_NAME,
  async (job: Job<ProcessingData>) => {
    const { taskId, url, jobId } = job.data;
    let acquiredAccountId: string | null = null;

    try {
      // ── Step 1: Check if parent job is cancelled ──────────────
      const parentJob = await prisma.job.findUnique({
        where: { id: jobId },
        select: { status: true },
      });

      if (!parentJob || parentJob.status === "CANCELLED") {
        console.log(`[Worker] Job ${jobId} is cancelled, skipping task ${taskId}`);
        // Mark task as skipped (use FAILED with a message)
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "FAILED", errorMessage: "Job was cancelled" },
        });
        return { skipped: true, reason: "cancelled" };
      }

      // ── Step 2: Set job to PROCESSING on first task ───────────
      if (parentJob.status === "PENDING") {
        await prisma.job.update({
          where: { id: jobId, status: "PENDING" },
          data: { status: "PROCESSING" },
        }).catch(() => {
          // Another worker already transitioned it — that's fine
        });
      }

      // ── Step 3: Add jitter (anti-detection) ───────────────────
      await jitter();

      // ── Step 4: Acquire an account ────────────────────────────
      const account = await acquireAccount();

      if (!account) {
        console.log(`[Worker] No accounts available, requeueing task ${taskId}`);
        // Requeue the task with a delay
        await urlQueue.add("process-url", job.data, {
          delay: CONFIG.REQUEUE_DELAY_MS,
          jobId: `${taskId}-retry-${Date.now()}`,
        });
        return { requeued: true, reason: "no_accounts" };
      }

      acquiredAccountId = account.id;
      console.log(`[Worker] Acquired account ${account.name || account.accountId} for task ${taskId}`);

      // ── Step 5: Check rate limit ──────────────────────────────
      const rateCheck = await checkRateLimit(account.accountId);

      if (!rateCheck.allowed) {
        console.log(`[Worker] Rate limit hit for account ${account.accountId}, requeueing`);
        await releaseAccount(account.id, false);
        acquiredAccountId = null;

        await urlQueue.add("process-url", job.data, {
          delay: rateCheck.retryAfterMs || 10000,
          jobId: `${taskId}-ratelimit-${Date.now()}`,
        });
        return { requeued: true, reason: "rate_limited" };
      }

      // ── Step 6: Extract LinkedIn identifier ───────────────────
      const identifier = extractIdentifier(url);

      if (!identifier) {
        // Non-retryable: invalid URL format
        console.error(`[Worker] Could not extract identifier from ${url}`);
        await markTaskFailed(taskId, jobId, "Invalid LinkedIn URL format");
        await releaseAccount(account.id, false);
        acquiredAccountId = null;
        return { failed: true, reason: "invalid_url" };
      }

      // ── Step 7: Update task to PROCESSING ─────────────────────
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "PROCESSING", accountId: account.id },
      });

      // ── Step 8: Call Unipile API ──────────────────────────────
      const profileData = await fetchProfile(account.accountId, identifier);

      // ── Step 9: Record the request for rate limiting ──────────
      await recordRequest(account.accountId);

      // ── Step 10: Run AI Analysis (if job has config) ──────────
      let analysisResultJson: string | null = null;

      try {
        const parentJobForConfig = await prisma.job.findUnique({
          where: { id: jobId },
          select: { config: true },
        });

        if (parentJobForConfig?.config) {
          const jobConfig: AnalysisConfig = JSON.parse(parentJobForConfig.config);

          if (jobConfig.jobDescription) {
            console.log(`[Worker] Running AI analysis for task ${taskId}...`);
            const analysisResult = await analyzeProfile(profileData, jobConfig);
            analysisResultJson = JSON.stringify(analysisResult);
            console.log(`[Worker] Analysis: ${analysisResult.scorePercent}% → ${analysisResult.recommendation}`);

            // ── Step 10b: Export to Google Sheet (if configured) ──
            if ((jobConfig as any).sheetWebAppUrl) {
              try {
                const jdTitle = (jobConfig as any).jdTitle || "Bulk Analysis";
                const payload = buildSheetPayload(url, analysisResult, jdTitle);
                const sheetResult = await exportToSheet((jobConfig as any).sheetWebAppUrl, payload);
                if (sheetResult.success) {
                  console.log(`[Worker] ✓ Exported to Google Sheet`);
                } else {
                  console.warn(`[Worker] Sheet export failed: ${sheetResult.error}`);
                }
              } catch (sheetErr: any) {
                console.warn(`[Worker] Sheet export error (non-fatal): ${sheetErr.message}`);
              }
            }
          }
        }
      } catch (analysisErr: any) {
        console.error(`[Worker] ⚠️  Analysis failed (non-fatal): ${analysisErr.message}`);
        console.error(`[Worker] ⚠️  Make sure OPENAI_API_KEY is set in your .env file`);
        // Analysis failure is non-fatal — profile data was still scraped successfully
      }

      // ── Step 11: SUCCESS — update task and job ─────────────────
      await prisma.$transaction(async (tx: any) => {
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: "DONE",
            result: JSON.stringify(profileData),
            analysisResult: analysisResultJson,
            accountId: account.id,
          },
        });

        const updatedJob = await tx.job.update({
          where: { id: jobId },
          data: {
            processedCount: { increment: 1 },
            successCount: { increment: 1 },
          },
        });

        // Check if all tasks are done
        if (updatedJob.processedCount >= updatedJob.totalTasks) {
          await tx.job.update({
            where: { id: jobId },
            data: { status: "COMPLETED" },
          });
        }
      });

      // Release account
      await releaseAccount(account.id, true);
      acquiredAccountId = null;

      console.log(`[Worker] ✓ Task ${taskId} completed (${identifier})`);
      return { success: true, identifier };

    } catch (error: any) {
      // ── ERROR HANDLING ────────────────────────────────────────

      if (error instanceof RateLimitError) {
        // 429 — cooldown the account and let BullMQ retry
        console.warn(`[Worker] 429 Rate limit for task ${taskId}: ${error.message}`);
        if (acquiredAccountId) {
          await cooldownAccount(acquiredAccountId);
          await releaseAccount(acquiredAccountId, false);
          acquiredAccountId = null;
        }
        // Reset task back to PENDING so it can be picked up again
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "PENDING", retryCount: { increment: 1 } },
        });
        throw error; // BullMQ will retry with exponential backoff
      }

      if (error instanceof ServerError || error instanceof NetworkError) {
        // 5xx / network — release account, let BullMQ retry
        console.warn(`[Worker] Retryable error for task ${taskId}: ${error.message}`);
        if (acquiredAccountId) {
          await releaseAccount(acquiredAccountId, false);
          acquiredAccountId = null;
        }
        await prisma.task.update({
          where: { id: taskId },
          data: { status: "PENDING", retryCount: { increment: 1 } },
        });
        throw error; // BullMQ will retry
      }

      if (error instanceof ClientError) {
        // 4xx (not 429) — non-retryable
        console.error(`[Worker] Client error for task ${taskId}: ${error.message}`);
        if (acquiredAccountId) {
          await releaseAccount(acquiredAccountId, false);
          acquiredAccountId = null;
        }
        await markTaskFailed(taskId, jobId, error.message);
        // Throw UnrecoverableError so BullMQ does NOT retry
        throw new UnrecoverableError(error.message);
      }

      // Unknown error — treat as retryable
      console.error(`[Worker] Unexpected error for task ${taskId}:`, error);
      if (acquiredAccountId) {
        await releaseAccount(acquiredAccountId, false);
        acquiredAccountId = null;
      }
      await prisma.task.update({
        where: { id: taskId },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
      throw error;

    } finally {
      // Safety net: always release account
      if (acquiredAccountId) {
        await releaseAccount(acquiredAccountId, false).catch(() => {});
      }
    }
  },
  {
    connection,
    concurrency: CONFIG.WORKER_CONCURRENCY,
  }
);

// ─── Helper: mark a task as permanently failed ─────────────────────
async function markTaskFailed(taskId: string, jobId: string, errorMessage: string) {
  await prisma.$transaction(async (tx: any) => {
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: "FAILED",
        errorMessage,
      },
    });

    const updatedJob = await tx.job.update({
      where: { id: jobId },
      data: {
        processedCount: { increment: 1 },
        failedCount: { increment: 1 },
      },
    });

    if (updatedJob.processedCount >= updatedJob.totalTasks) {
      // Determine final status based on success/failure ratio
      const finalStatus = updatedJob.successCount > 0 ? "COMPLETED" : "FAILED";
      await tx.job.update({
        where: { id: jobId },
        data: { status: finalStatus },
      });
    }
  });
}

// ─── Worker event listeners ────────────────────────────────────────
worker.on("completed", (job: Job) => {
  const result = job.returnvalue;
  if (result?.skipped) {
    console.log(`[Worker] Task ${job.data.taskId} skipped (${result.reason})`);
  } else if (result?.requeued) {
    console.log(`[Worker] Task ${job.data.taskId} requeued (${result.reason})`);
  }
});

worker.on("failed", async (job: Job | undefined, err: Error) => {
  if (!job) return;
  const taskId = job.data.taskId;
  const attempts = job.attemptsMade;
  console.error(`[Worker] Task ${taskId} failed (attempt ${attempts}/${CONFIG.MAX_RETRIES}): ${err.message}`);

  // If max retries exhausted, mark as permanently failed
  if (attempts >= CONFIG.MAX_RETRIES) {
    console.error(`[Worker] Task ${taskId} exhausted all retries, marking FAILED`);
    try {
      await markTaskFailed(taskId, job.data.jobId, `Exhausted ${CONFIG.MAX_RETRIES} retries: ${err.message}`);
    } catch (updateError) {
      console.error("[Worker] Failed to update DB on final failure:", updateError);
    }
  }
});

worker.on("error", (err: Error) => {
  console.error("[Worker] Worker-level error:", err);
});

// ─── Graceful shutdown ─────────────────────────────────────────────
async function shutdown() {
  console.log("[Worker] Shutting down gracefully...");
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[Worker] Ready and listening for tasks.");

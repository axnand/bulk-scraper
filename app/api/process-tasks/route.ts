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
  const taskStart = Date.now();
  const tag = `[Task ${task.id.slice(-6)}]`;

  // Optimistic claim — only succeeds if task is still PENDING
  const claimed = await prisma.task
    .update({
      where: { id: task.id, status: "PENDING" },
      data: { status: "PROCESSING", accountId: account.id },
    })
    .catch(() => null);

  if (!claimed) {
    console.log(`${tag} Claim failed — already grabbed by another worker. Releasing account.`);
    await releaseAccount(account.id, false);
    return;
  }

  console.log(`${tag} Claimed. url=${task.url} retry=${task.retryCount} acct=${account.accountId.slice(-6)}`);

  if (task.job.status === "CANCELLED") {
    console.log(`${tag} Job is CANCELLED — marking task failed.`);
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "FAILED", errorMessage: "Job was cancelled" },
    });
    await releaseAccount(account.id, false);
    return;
  }

  if (task.job.status === "PAUSED") {
    console.log(`${tag} Job is PAUSED — returning task to PENDING.`);
    // Release task back to PENDING so it can be picked up after resume
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "PENDING", accountId: null },
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
      console.error(`${tag} Invalid LinkedIn URL, marking failed.`);
      await markTaskFailed(task.id, task.jobId, "Invalid LinkedIn URL format");
      return;
    }

    await jitter();

    // ── Stage 1: Fetch profile ──
    const fetchStart = Date.now();
    console.log(`${tag} [1/3] Fetching LinkedIn profile (identifier: ${identifier})...`);
    let profileData: any;
    try {
      profileData = await fetchProfile(
        account.accountId,
        identifier,
        account.dsn || undefined,
        account.apiKey || undefined
      );
      console.log(`${tag} [1/3] Fetch OK — ${Date.now() - fetchStart}ms. name="${profileData.first_name || ""} ${profileData.last_name || ""}"`);
    } catch (fetchErr: any) {
      console.error(`${tag} [1/3] Fetch FAILED after ${Date.now() - fetchStart}ms: ${fetchErr.name}: ${fetchErr.message}`);
      throw fetchErr;
    }

    // ── Stage 2: Persist candidate profile ──
    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        linkedinUrl: task.url,
        name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
        headline: profileData.headline || "",
        location: profileData.location || "",
        rawProfile: JSON.stringify(profileData),
      },
    });

    // ── Stage 3: AI analysis (optional) ──
    let analysisResultJson: string | null = null;
    const jobConfig = await getJobConfig(task.jobId);

    if (jobConfig?.jobDescription) {
      const analysisStart = Date.now();
      console.log(`${tag} [2/3] Running AI analysis (model: ${(jobConfig as any).aiModel || "unknown"})...`);
      try {
        const analysisResult = await analyzeProfile(profileData, jobConfig);
        analysisResultJson = JSON.stringify(analysisResult);
        console.log(`${tag} [2/3] Analysis OK — ${Date.now() - analysisStart}ms. score=${analysisResult.scorePercent}% (${analysisResult.totalScore}/${analysisResult.maxScore}) → ${analysisResult.recommendation}`);

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

        // ── Stage 4: Sheet export (optional) ──
        const sheetUrl = (jobConfig as any).sheetWebAppUrl;
        if (sheetUrl) {
          const minThreshold = (jobConfig as any).minScoreThreshold ?? 0;
          if (analysisResult.scorePercent >= minThreshold) {
            const sheetStart = Date.now();
            console.log(`${tag} [3/3] Exporting to sheet (score ${analysisResult.scorePercent}% >= threshold ${minThreshold}%)...`);
            const jdTitle = (jobConfig as any).jdTitle || "Bulk Analysis";
            const payload = buildSheetPayload(
              task.url,
              analysisResult,
              jdTitle,
              jobConfig.scoringRules
            );
            try {
              await exportToSheet(sheetUrl, payload);
              console.log(`${tag} [3/3] Sheet export OK — ${Date.now() - sheetStart}ms`);
            } catch (sheetErr: any) {
              console.warn(`${tag} [3/3] Sheet export FAILED after ${Date.now() - sheetStart}ms: ${sheetErr.message}`);
            }
          } else {
            console.log(`${tag} [3/3] Sheet export SKIPPED — score ${analysisResult.scorePercent}% < threshold ${minThreshold}%`);
          }
        } else {
          console.log(`${tag} [3/3] Sheet export SKIPPED — no sheetWebAppUrl configured`);
        }
      } catch (analysisErr: any) {
        console.warn(
          `${tag} [2/3] Analysis FAILED after ${Date.now() - analysisStart}ms: ${analysisErr.message}`
        );
      }
    } else {
      console.log(`${tag} [2/3] Analysis SKIPPED — no jobDescription in config`);
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
      console.log(`${tag} Job ${task.jobId.slice(-6)} complete! (${updatedJob.processedCount}/${updatedJob.totalTasks})`);
      await prisma.job.update({
        where: { id: task.jobId },
        data: { status: "COMPLETED" },
      });
    }

    success = true;
    console.log(`${tag} DONE in ${Date.now() - taskStart}ms. Job progress: ${updatedJob.processedCount}/${updatedJob.totalTasks}`);
  } catch (error: any) {
    const elapsed = Date.now() - taskStart;
    if (error instanceof RateLimitError) {
      console.warn(`${tag} RATE LIMITED after ${elapsed}ms — cooling down account. retryAfter=${error.retryAfterMs}ms`);
      await cooldownAccount(account.id);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ServerError || error instanceof NetworkError) {
      console.warn(`${tag} RETRYABLE ERROR after ${elapsed}ms (${error.name}): ${error.message}. retry=${task.retryCount + 1}`);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ClientError) {
      console.error(`${tag} CLIENT ERROR after ${elapsed}ms (status=${error.statusCode}): ${error.message}. Marking failed.`);
      await markTaskFailed(task.id, task.jobId, error.message);
    } else {
      console.error(`${tag} UNKNOWN ERROR after ${elapsed}ms:`, error);
      if (task.retryCount >= CONFIG.MAX_RETRIES) {
        console.error(`${tag} Exhausted retries (${task.retryCount}/${CONFIG.MAX_RETRIES}). Marking failed.`);
        await markTaskFailed(
          task.id,
          task.jobId,
          `Exhausted retries: ${error.message || "Unknown error"}`
        );
      } else {
        console.warn(`${tag} Retrying (${task.retryCount + 1}/${CONFIG.MAX_RETRIES})...`);
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "PENDING", retryCount: { increment: 1 } },
        });
      }
    }
  } finally {
    // ALWAYS release the account — prevents accounts stuck in BUSY
    await releaseAccount(account.id, success).catch((err) => {
      console.error(`${tag} CRITICAL: Failed to release account ${account.id} — it will stay BUSY until stale recovery: ${err.message}`);
    });
  }
}

// ─── Processing Loop (runs inside after(), no HTTP self-calls) ──────

async function logAccountPoolState(label: string) {
  const [active, busy, cooldown] = await Promise.all([
    prisma.account.count({ where: { status: "ACTIVE" } }),
    prisma.account.count({ where: { status: "BUSY" } }),
    prisma.account.count({ where: { status: "COOLDOWN" } }),
  ]);
  const atMinuteLimit = await prisma.account.count({
    where: { status: "ACTIVE", minuteCount: { gte: CONFIG.MAX_REQUESTS_PER_MINUTE } },
  });
  const atDailyLimit = await prisma.account.count({
    where: { status: "ACTIVE", dailyCount: { gte: CONFIG.DAILY_SAFE_LIMIT } },
  });
  console.log(
    `[AccountPool][${label}] ACTIVE=${active} BUSY=${busy} COOLDOWN=${cooldown} | atMinuteLimit=${atMinuteLimit} atDailyLimit=${atDailyLimit}`
  );
}

async function runProcessingCycle(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  remaining: number;
}> {
  const cycleStart = Date.now();

  const recovery = await recoverStaleState();
  if (recovery.recoveredTasks > 0 || recovery.checkedAccounts > 0) {
    console.log(`[Process] Recovery: ${recovery.recoveredTasks} stale tasks reset, ${recovery.checkedAccounts} BUSY accounts checked`);
  }

  const concurrency = await getWorkerConcurrency();
  console.log(`[Process] Worker concurrency: ${concurrency}`);

  await logAccountPoolState("before-acquire");

  const pendingTasks = await prisma.task.findMany({
    where: {
      status: "PENDING",
      job: { status: { notIn: ["PAUSED", "CANCELLED"] } },
    },
    orderBy: [{ retryCount: "asc" }, { createdAt: "asc" }],
    take: concurrency,
    include: { job: { select: { status: true, id: true } } },
  });

  if (pendingTasks.length === 0) {
    const processingCount = await prisma.task.count({ where: { status: "PROCESSING" } });
    console.log(`[Process] No PENDING tasks found. PROCESSING in-flight: ${processingCount}`);
    return { processed: 0, succeeded: 0, failed: 0, remaining: 0 };
  }

  console.log(`[Process] Found ${pendingTasks.length} PENDING tasks. Acquiring accounts...`);

  const accounts = await acquireAccounts(pendingTasks.length);

  await logAccountPoolState("after-acquire");

  if (accounts.length === 0) {
    const remaining = await prisma.task.count({ where: { status: "PENDING" } });
    console.warn(`[Process] NO ACCOUNTS AVAILABLE — ${remaining} tasks stuck waiting. Check account pool state above.`);
    return { processed: 0, succeeded: 0, failed: 0, remaining };
  }

  const pairs = pendingTasks
    .slice(0, accounts.length)
    .map((task, i) => ({ task, account: accounts[i] }));

  for (let i = pairs.length; i < accounts.length; i++) {
    console.log(`[Process] Releasing surplus account ${accounts[i].id.slice(-6)}`);
    await releaseAccount(accounts[i].id, false);
  }

  console.log(`[Process] Dispatching ${pairs.length} tasks in parallel (wanted ${pendingTasks.length}, got ${accounts.length} accounts)...`);

  const results = await Promise.allSettled(
    pairs.map(({ task, account }) => processOneTask(task, account))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const remaining = await prisma.task.count({ where: { status: "PENDING" } });

  console.log(`[Process] Cycle complete in ${Date.now() - cycleStart}ms — dispatched=${pairs.length} settled_ok=${succeeded} settled_err=${failed} remaining=${remaining}`);

  return { processed: pairs.length, succeeded, failed, remaining };
}

async function logOverallJobState(label: string) {
  const [pending, processing, done, failed] = await Promise.all([
    prisma.task.count({ where: { status: "PENDING" } }),
    prisma.task.count({ where: { status: "PROCESSING" } }),
    prisma.task.count({ where: { status: "DONE" } }),
    prisma.task.count({ where: { status: "FAILED" } }),
  ]);
  console.log(`[JobState][${label}] PENDING=${pending} PROCESSING=${processing} DONE=${done} FAILED=${failed} total=${pending + processing + done + failed}`);
}

async function processLoop(): Promise<void> {
  const startTime = Date.now();
  const MAX_LOOP_MS = 50000; // Stay under Vercel's 60s limit
  let cycleCount = 0;

  console.log("[Process] processLoop started");
  await logOverallJobState("loop-start");

  while (Date.now() - startTime < MAX_LOOP_MS) {
    cycleCount++;
    const elapsed = Date.now() - startTime;
    console.log(`[Process] ── Cycle #${cycleCount} (elapsed ${elapsed}ms / ${MAX_LOOP_MS}ms) ──`);

    try {
      const result = await runProcessingCycle();

      if (result.remaining === 0) {
        console.log(`[Process] All tasks done after ${cycleCount} cycle(s) in ${Date.now() - startTime}ms.`);
        await logOverallJobState("loop-done");
        return;
      }

      if (result.processed === 0) {
        // No accounts available — wait for them to free up or for cooldowns to expire
        const waitMs = 5000;
        console.log(`[Process] No accounts available (${result.remaining} tasks waiting). Sleeping ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        // Brief pause for rate-limit windows
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      console.error("[Process] Cycle error:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Ran out of time — self-chain so processing continues without waiting for the cron
  const remaining = await prisma.task.count({ where: { status: "PENDING" } });
  await logOverallJobState("loop-timeout");

  if (remaining > 0) {
    console.log(
      `[Process] Time limit reached after ${cycleCount} cycle(s) — ${remaining} tasks still PENDING. Self-chaining to continue...`
    );
    // Fire-and-forget: triggers a new after() chain without waiting for cron
    triggerProcessing().catch((err) => {
      console.error("[Process] Self-chain trigger failed:", err.message);
    });
  } else {
    console.log(`[Process] Time limit reached — no remaining tasks. Exiting cleanly.`);
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

  console.log("[Process] POST received — scheduling processLoop via after()");

  // Run the processing loop in after() so the response returns immediately
  after(async () => {
    console.log("[Process] after() callback starting...");
    const t = Date.now();
    try {
      await processLoop();
    } catch (err: any) {
      console.error("[Process] after() callback crashed:", err.message, err.stack);
    } finally {
      console.log(`[Process] after() callback finished in ${Date.now() - t}ms`);
    }
  });

  return NextResponse.json({ message: "Processing started" });
}

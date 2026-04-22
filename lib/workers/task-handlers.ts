import type { JobWithMetadata } from "pg-boss";
import { prisma } from "@/lib/prisma";
import { CONFIG, jitter } from "@/lib/config";
import {
  acquireAccount,
  releaseAccount,
  cooldownAccount,
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
import { buildVars, renderTemplate } from "@/lib/outreach/render-template";

// ─── Shared Helpers ────────────────────────────────────────────────

async function getJobConfig(jobId: string): Promise<AnalysisConfig | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { config: true },
  });
  if (job?.config) {
    try { return JSON.parse(job.config) as AnalysisConfig; } catch { return null; }
  }
  return null;
}

async function markTaskFailed(taskId: string, jobId: string, errorMessage: string) {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: "FAILED", errorMessage },
  });
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: { processedCount: { increment: 1 }, failedCount: { increment: 1 } },
  });
  if (updatedJob.processedCount >= updatedJob.totalTasks) {
    const finalStatus = updatedJob.successCount > 0 ? "COMPLETED" : "FAILED";
    await prisma.job.update({ where: { id: jobId }, data: { status: finalStatus } });
  }
}

async function updateJobProgress(jobId: string, succeeded: boolean) {
  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: {
      processedCount: { increment: 1 },
      ...(succeeded ? { successCount: { increment: 1 } } : { failedCount: { increment: 1 } }),
    },
  });
  if (updatedJob.processedCount >= updatedJob.totalTasks) {
    const finalStatus = updatedJob.successCount > 0 ? "COMPLETED" : "FAILED";
    await prisma.job.update({ where: { id: jobId }, data: { status: finalStatus } });
  }
  return updatedJob;
}

async function maybeAutoShortlist(
  taskId: string,
  jobId: string,
  profileData: any,
  analysisResult: any,
) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { requisitionId: true },
    });
    if (!job?.requisitionId) return;

    const campaign = await prisma.campaign.findFirst({
      where: { requisitionId: job.requisitionId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    if (!campaign) return;

    let threshold = 70;
    try {
      const t = JSON.parse(campaign.threshold);
      if (typeof t?.minScorePercent === "number") threshold = t.minScorePercent;
    } catch { /* keep default */ }

    if (analysisResult?.scorePercent == null || analysisResult.scorePercent < threshold) return;

    const current = await prisma.task.findUnique({
      where: { id: taskId },
      select: { stage: true, outreachMessages: { select: { id: true, campaignId: true } } },
    });
    if (!current) return;

    const skipStages = new Set(["SHORTLISTED", "CONTACT_REQUESTED", "CONNECTED", "REPLIED", "INTERVIEW", "HIRED", "REJECTED", "ARCHIVED"]);
    if (skipStages.has(current.stage)) return;

    const alreadyHasMsg = current.outreachMessages.some((m) => m.campaignId === campaign.id);
    if (alreadyHasMsg) return;

    let tpl: { subject?: string; body?: string } = {};
    try { tpl = JSON.parse(campaign.template); } catch { /* ignore */ }

    const vars = buildVars(profileData, analysisResult);
    const renderedBody = renderTemplate(tpl.body ?? "", vars);
    const renderedSubject = tpl.subject ? renderTemplate(tpl.subject, vars) : undefined;

    const now = new Date();
    const msgStatus = campaign.approvalMode === "AUTO" ? "APPROVED" : "AWAITING_REVIEW";

    await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: { stage: "SHORTLISTED", stageUpdatedAt: now },
      }),
      prisma.outreachMessage.create({
        data: {
          campaignId: campaign.id,
          taskId,
          channel: campaign.channel,
          status: msgStatus,
          renderedBody,
          renderedSubject,
          approvedAt: msgStatus === "APPROVED" ? now : undefined,
        },
      }),
      prisma.stageEvent.create({
        data: {
          taskId,
          fromStage: "SOURCED",
          toStage: "SHORTLISTED",
          actor: "SYSTEM",
          reason: `score ${Math.round(analysisResult.scorePercent)}% ≥ threshold ${threshold}%`,
        },
      }),
    ]);

    console.log(`[AutoShortlist] Task ${taskId.slice(-6)} shortlisted (score=${Math.round(analysisResult.scorePercent)}%)`);
  } catch (err: any) {
    console.warn(`[AutoShortlist] Task ${taskId.slice(-6)} hook failed: ${err.message}`);
  }
}

// ─── LinkedIn Task Processor ───────────────────────────────────────

async function processLinkedInTask(
  task: {
    id: string;
    url: string;
    jobId: string;
    retryCount: number;
    source: string;
    sourceFileName: string | null;
    result: string | null;
    job: { status: string; id: string };
  },
  account: { id: string; accountId: string; dsn: string | null; apiKey: string | null },
  isLastAttempt: boolean
): Promise<void> {
  const taskStart = Date.now();
  const tag = `[Task ${task.id.slice(-6)}]`;

  // Claim — allow PROCESSING in addition to PENDING to handle pg-boss retries on expired jobs
  const claimed = await prisma.task
    .update({
      where: { id: task.id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "PROCESSING", accountId: account.id },
    })
    .catch(() => null);

  if (!claimed) {
    console.log(`${tag} Claim failed — task is DONE or FAILED. Releasing account.`);
    await releaseAccount(account.id, false);
    return;
  }

  console.log(`${tag} Claimed. url=${task.url} retry=${task.retryCount} acct=${account.accountId.slice(-6)}`);

  if (task.job.status === "CANCELLED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "FAILED", errorMessage: "Job was cancelled" } });
    await releaseAccount(account.id, false);
    return;
  }

  if (task.job.status === "PAUSED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "PENDING", accountId: null } });
    await releaseAccount(account.id, false);
    return; // don't throw — pg-boss marks this job complete; re-enqueued on resume
  }

  if (task.job.status === "PENDING") {
    await prisma.job
      .update({ where: { id: task.job.id, status: "PENDING" }, data: { status: "PROCESSING" } })
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

    // ── Fetch ──
    const fetchStart = Date.now();
    console.log(`${tag} [1/3] Fetching LinkedIn profile...`);
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
      console.error(`${tag} [1/3] Fetch FAILED — ${Date.now() - fetchStart}ms: ${fetchErr.name}: ${fetchErr.message}`);
      throw fetchErr;
    }

    // ── Persist candidate ──
    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        linkedinUrl: task.url,
        name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
        headline: profileData.headline || "",
        location: profileData.location || "",
        rawProfile: JSON.stringify(profileData),
      },
    });

    // ── AI analysis ──
    let analysisResultJson: string | null = null;
    const jobConfig = await getJobConfig(task.jobId);

    if (jobConfig?.jobDescription) {
      const analysisStart = Date.now();
      console.log(`${tag} [2/3] Running AI analysis...`);
      try {
        const analysisResult = await analyzeProfile(profileData, jobConfig);
        analysisResultJson = JSON.stringify(analysisResult);
        console.log(`${tag} [2/3] Analysis OK — ${Date.now() - analysisStart}ms. score=${analysisResult.scorePercent}% → ${analysisResult.recommendation}`);

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

        // ── Sheet export ──
        const sheetUrl = (jobConfig as any).sheetWebAppUrl;
        if (sheetUrl) {
          const minThreshold = (jobConfig as any).minScoreThreshold ?? 0;
          if (analysisResult.scorePercent >= minThreshold) {
            const sheetStart = Date.now();
            console.log(`${tag} [3/3] Exporting to sheet...`);
            const payload = buildSheetPayload(
              task.url,
              analysisResult,
              (jobConfig as any).jdTitle || "Bulk Analysis",
              jobConfig.scoringRules as Record<string, boolean | undefined>,
              jobConfig
            );
            await exportToSheet(sheetUrl, payload).catch((sheetErr: any) => {
              console.warn(`${tag} [3/3] Sheet export FAILED: ${sheetErr.message}`);
            });
            console.log(`${tag} [3/3] Sheet export OK — ${Date.now() - sheetStart}ms`);
          } else {
            console.log(`${tag} [3/3] Sheet export SKIPPED — score ${analysisResult.scorePercent}% < threshold ${minThreshold}%`);
          }
        }
      } catch (analysisErr: any) {
        console.warn(`${tag} [2/3] Analysis FAILED: ${analysisErr.message}`);
      }
    }

    await prisma.task.update({
      where: { id: task.id },
      data: { status: "DONE", result: JSON.stringify(profileData), analysisResult: analysisResultJson, accountId: account.id },
    });

    if (analysisResultJson) {
      await maybeAutoShortlist(task.id, task.jobId, profileData, JSON.parse(analysisResultJson));
    }

    const updatedJob = await prisma.job.update({
      where: { id: task.jobId },
      data: { processedCount: { increment: 1 }, successCount: { increment: 1 } },
    });
    if (updatedJob.processedCount >= updatedJob.totalTasks) {
      await prisma.job.update({ where: { id: task.jobId }, data: { status: "COMPLETED" } });
    }

    success = true;
    console.log(JSON.stringify({ event: "task_done", taskId: task.id, jobId: task.jobId, accountId: account.id, source: "linkedin", durationMs: Date.now() - taskStart, outcome: "success" }));
  } catch (error: any) {
    const elapsed = Date.now() - taskStart;
    if (error instanceof RateLimitError) {
      console.warn(`${tag} RATE LIMITED after ${elapsed}ms — cooling down account`);
      await cooldownAccount(account.id);
      if (isLastAttempt) {
        console.log(JSON.stringify({ event: "task_done", taskId: task.id, jobId: task.jobId, accountId: account.id, source: "linkedin", durationMs: elapsed, outcome: "failed", reason: "rate_limit_retries_exhausted" }));
        await markTaskFailed(task.id, task.jobId, `Rate limited — retries exhausted: ${error.message}`);
      } else {
        await prisma.task.update({ where: { id: task.id }, data: { status: "PENDING", retryCount: { increment: 1 } } });
        throw error; // pg-boss reschedules with backoff
      }
    } else if (error instanceof ServerError || error instanceof NetworkError) {
      console.warn(`${tag} RETRYABLE ERROR after ${elapsed}ms (${error.name}): ${error.message}`);
      if (isLastAttempt) {
        console.log(JSON.stringify({ event: "task_done", taskId: task.id, jobId: task.jobId, accountId: account.id, source: "linkedin", durationMs: elapsed, outcome: "failed", reason: "retries_exhausted", error: error.name }));
        await markTaskFailed(task.id, task.jobId, `Retries exhausted (${error.name}): ${error.message}`);
      } else {
        await prisma.task.update({ where: { id: task.id }, data: { status: "PENDING", retryCount: { increment: 1 } } });
        throw error; // pg-boss reschedules with backoff
      }
    } else if (error instanceof ClientError) {
      console.error(`${tag} CLIENT ERROR (status=${error.statusCode}): ${error.message}. Marking FAILED.`);
      console.log(JSON.stringify({ event: "task_done", taskId: task.id, jobId: task.jobId, accountId: account.id, source: "linkedin", durationMs: elapsed, outcome: "failed", reason: "client_error", statusCode: error.statusCode }));
      await markTaskFailed(task.id, task.jobId, error.message);
    } else {
      console.error(`${tag} UNKNOWN ERROR after ${elapsed}ms:`, error);
      if (isLastAttempt || task.retryCount + 1 >= CONFIG.MAX_RETRIES) {
        console.log(JSON.stringify({ event: "task_done", taskId: task.id, jobId: task.jobId, accountId: account.id, source: "linkedin", durationMs: elapsed, outcome: "failed", reason: "unknown_retries_exhausted" }));
        await markTaskFailed(task.id, task.jobId, `Exhausted retries: ${error.message || "Unknown error"}`);
      } else {
        await prisma.task.update({ where: { id: task.id }, data: { status: "PENDING", retryCount: { increment: 1 } } });
        throw error; // pg-boss reschedules with backoff
      }
    }
  } finally {
    await releaseAccount(account.id, success).catch((err: any) => {
      console.error(`${tag} CRITICAL: Failed to release account: ${err.message}`);
    });
  }
}

// ─── Resume Task Processor ─────────────────────────────────────────

async function processResumeTask(
  task: {
    id: string;
    url: string;
    jobId: string;
    retryCount: number;
    source: string;
    sourceFileName: string | null;
    result: string | null;
    job: { status: string; id: string };
  },
  isLastAttempt: boolean
): Promise<void> {
  const tag = `[ResumeTask ${task.id.slice(-6)}]`;

  const claimed = await prisma.task
    .update({
      where: { id: task.id, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "PROCESSING" },
    })
    .catch(() => null);

  if (!claimed) {
    console.log(`${tag} Claim failed — already DONE or FAILED.`);
    return;
  }

  console.log(`${tag} Claimed: ${task.sourceFileName || task.url}`);

  if (task.job.status === "CANCELLED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "FAILED", errorMessage: "Job was cancelled" } });
    await updateJobProgress(task.jobId, false);
    return;
  }

  if (task.job.status === "PAUSED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "PENDING" } });
    return; // don't throw — re-enqueued on resume
  }

  if (task.job.status === "PENDING") {
    await prisma.job
      .update({ where: { id: task.job.id, status: "PENDING" }, data: { status: "PROCESSING" } })
      .catch(() => {});
  }

  try {
    let preloaded: any = null;
    try { preloaded = task.result ? JSON.parse(task.result) : null; } catch { /* ignore */ }

    if (!preloaded?.resumeText) {
      await prisma.task.update({ where: { id: task.id }, data: { status: "FAILED", errorMessage: "No extracted text available" } });
      await updateJobProgress(task.jobId, false);
      return;
    }

    const jobConfig = await getJobConfig(task.jobId);
    if (!jobConfig?.jobDescription) {
      await prisma.task.update({ where: { id: task.id }, data: { status: "DONE" } });
      await updateJobProgress(task.jobId, true);
      return;
    }

    const analysisStart = Date.now();
    console.log(`${tag} Running AI analysis on resume text (${preloaded.resumeText.length} chars)...`);
    const analysisResult = await analyzeProfile(preloaded, jobConfig);
    const analysisResultJson = JSON.stringify(analysisResult);
    console.log(`${tag} Analysis OK — ${Date.now() - analysisStart}ms. score=${analysisResult.scorePercent}%`);

    await prisma.task.update({
      where: { id: task.id },
      data: { status: "DONE", analysisResult: analysisResultJson },
    });
    await updateJobProgress(task.jobId, true);
    await maybeAutoShortlist(task.id, task.jobId, preloaded, analysisResult);

    const sheetUrl = (jobConfig as any).sheetWebAppUrl;
    if (sheetUrl) {
      const minThreshold = (jobConfig as any).minScoreThreshold ?? 0;
      if (analysisResult.scorePercent >= minThreshold) {
        const payload = buildSheetPayload(
          task.url,
          analysisResult,
          (jobConfig as any).jdTitle || "Resume Upload",
          jobConfig.scoringRules as Record<string, boolean | undefined>,
          jobConfig
        );
        await exportToSheet(sheetUrl, payload).catch((e: any) => {
          console.warn(`${tag} Sheet export failed: ${e.message}`);
        });
      }
    }
  } catch (err: any) {
    console.error(`${tag} FAILED: ${err.message}`);
    if (isLastAttempt) {
      console.log(JSON.stringify({ event: "task_done", taskId: task.id, jobId: task.jobId, source: "resume", outcome: "failed", reason: "retries_exhausted" }));
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "FAILED", errorMessage: err.message || "Analysis failed" },
      });
      await updateJobProgress(task.jobId, false);
    } else {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", errorMessage: err.message || "Analysis failed" },
      });
      throw err; // pg-boss reschedules with backoff
    }
  }
}

// ─── pg-boss Handlers ──────────────────────────────────────────────

type TaskJobData = { taskId: string };

// pg-boss calls these handlers with an array (batchSize defaults to 1 per worker).
// We iterate sequentially so any throw propagates back to pg-boss, which triggers retry.
// localConcurrency: N means N parallel worker invocations, each getting 1 job.

export async function handleLinkedInJobs(jobs: JobWithMetadata<TaskJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { taskId } = job.data;
    const tag = `[Task ${taskId.slice(-6)}]`;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { job: { select: { status: true, id: true } } },
    });

    if (!task) {
      console.warn(`${tag} Not found in DB — skipping`);
      continue;
    }

    // Job status is checked first — it is more authoritative than task status
    if (task.job.status === "CANCELLED") {
      console.log(`${tag} Job CANCELLED — marking task FAILED`);
      // Safe WHERE: don't overwrite tasks already DONE by a concurrent worker
      await prisma.task.update({
        where: { id: taskId, status: { in: ["PENDING", "PROCESSING"] } },
        data: { status: "FAILED", errorMessage: "Job was cancelled" },
      }).catch(() => {});
      continue;
    }

    if (task.job.status === "PAUSED") {
      console.log(`${tag} Job PAUSED — leaving as PENDING until resumed`);
      continue; // task stays PENDING; re-enqueued by cancel/route.ts on resume
    }

    // Skip tasks already finished (after job-level check so CANCELLED wins)
    if (task.status === "DONE" || task.status === "FAILED") {
      console.log(`${tag} Already ${task.status} — skipping`);
      continue;
    }

    const account = await acquireAccount();
    if (!account) {
      console.warn(`${tag} No accounts available — throwing to retry`);
      throw new Error("No accounts available");
    }

    const isLastAttempt = (job.retryCount ?? 0) >= (job.retryLimit ?? 3);
    await processLinkedInTask(task as any, account, isLastAttempt);
  }
}

export async function handleResumeJobs(jobs: JobWithMetadata<TaskJobData>[]): Promise<void> {
  for (const job of jobs) {
    const { taskId } = job.data;
    const tag = `[ResumeTask ${taskId.slice(-6)}]`;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { job: { select: { status: true, id: true } } },
    });

    if (!task) {
      console.warn(`${tag} Not found in DB — skipping`);
      continue;
    }

    // Job status first
    if (task.job.status === "CANCELLED") {
      console.log(`${tag} Job CANCELLED — marking task FAILED`);
      await prisma.task.update({
        where: { id: taskId, status: { in: ["PENDING", "PROCESSING"] } },
        data: { status: "FAILED", errorMessage: "Job was cancelled" },
      }).catch(() => {});
      await updateJobProgress(task.jobId, false);
      continue;
    }

    if (task.job.status === "PAUSED") {
      console.log(`${tag} Job PAUSED — leaving as PENDING until resumed`);
      continue;
    }

    if (task.status === "DONE" || task.status === "FAILED") {
      console.log(`${tag} Already ${task.status} — skipping`);
      continue;
    }

    const isLastAttempt = (job.retryCount ?? 0) >= (job.retryLimit ?? 3);
    await processResumeTask(task as any, isLastAttempt);
  }
}

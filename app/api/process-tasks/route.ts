import { NextRequest, NextResponse } from "next/server";
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
import { buildVars, renderTemplate } from "@/lib/outreach/render-template";

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
 * After a task is scored, check if an active Campaign threshold is met and
 * auto-advance to SHORTLISTED + create an OutreachMessage for review.
 */
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
      where: {
        requisitionId: job.requisitionId,
        status: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
    });
    if (!campaign) return;

    let threshold = 70;
    try {
      const t = JSON.parse(campaign.threshold);
      if (typeof t?.minScorePercent === "number") threshold = t.minScorePercent;
    } catch { /* keep default */ }

    if (analysisResult?.scorePercent == null || analysisResult.scorePercent < threshold) return;

    // Already shortlisted or beyond — don't regress
    const current = await prisma.task.findUnique({
      where: { id: taskId },
      select: { stage: true, outreachMessages: { select: { id: true, campaignId: true } } },
    });
    if (!current) return;
    const skipStages = new Set(["SHORTLISTED","CONTACT_REQUESTED","CONNECTED","REPLIED","INTERVIEW","HIRED","REJECTED","ARCHIVED"]);
    if (skipStages.has(current.stage)) return;

    // Deduplicate — don't create a second OutreachMessage for the same campaign
    const alreadyHasMsg = current.outreachMessages.some(m => m.campaignId === campaign.id);
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

    console.log(`[AutoShortlist] Task ${taskId.slice(-6)} shortlisted (score=${Math.round(analysisResult.scorePercent)}% threshold=${threshold}%)`);
  } catch (err: any) {
    console.warn(`[AutoShortlist] Task ${taskId.slice(-6)} hook failed: ${err.message}`);
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
    source: string;
    sourceFileName: string | null;
    result: string | null;
    job: { status: string; id: string };
  },
  account: { id: string; accountId: string; dsn: string | null; apiKey: string | null }
): Promise<void> {
  const taskStart = Date.now();
  const tag = `[Task ${task.id.slice(-6)}]`;

  console.log(`${tag} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`${tag} 🚀 TASK START — url="${task.url}" retry=${task.retryCount} jobStatus="${task.job.status}" acct="${account.accountId.slice(-6)}"`);
  console.log(`${tag}    account.dsn=${!!account.dsn} account.apiKey=${!!account.apiKey}`);

  // Optimistic claim — only succeeds if task is still PENDING
  console.log(`${tag} 🔒 Claiming task (optimistic lock)...`);
  const claimed = await prisma.task
    .update({
      where: { id: task.id, status: "PENDING" },
      data: { status: "PROCESSING", accountId: account.id },
    })
    .catch(() => null);

  if (!claimed) {
    console.log(`${tag} ⚠️ Claim failed — already grabbed by another worker. Releasing account.`);
    await releaseAccount(account.id, false);
    return;
  }

  console.log(`${tag} ✅ Claimed. url=${task.url} retry=${task.retryCount} acct=${account.accountId.slice(-6)}`);

  if (task.job.status === "CANCELLED") {
    console.log(`${tag} 🚫 Job is CANCELLED — marking task failed.`);
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "FAILED", errorMessage: "Job was cancelled" },
    });
    await releaseAccount(account.id, false);
    return;
  }

  if (task.job.status === "PAUSED") {
    console.log(`${tag} ⏸️ Job is PAUSED — returning task to PENDING.`);
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "PENDING", accountId: null },
    });
    await releaseAccount(account.id, false);
    return;
  }

  if (task.job.status === "PENDING") {
    console.log(`${tag} 📝 Transitioning job ${task.job.id.slice(-6)} PENDING → PROCESSING`);
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
      console.error(`${tag} ❌ Invalid LinkedIn URL — cannot extract identifier from "${task.url}". Marking failed.`);
      await markTaskFailed(task.id, task.jobId, "Invalid LinkedIn URL format");
      return;
    }

    console.log(`${tag} ⏳ Applying jitter before Unipile call...`);
    const jitterStart = Date.now();
    await jitter();
    console.log(`${tag} ⏳ Jitter done — ${Date.now() - jitterStart}ms`);

    // ── Stage 1: Fetch profile ──
    const fetchStart = Date.now();
    console.log(`${tag} [1/3] 🌐 UNIPILE FETCH START — identifier="${identifier}" @ ${new Date().toISOString()}`);
    let profileData: any;
    try {
      profileData = await fetchProfile(
        account.accountId,
        identifier,
        account.dsn || undefined,
        account.apiKey || undefined
      );
      const fetchMs = Date.now() - fetchStart;
      console.log(`${tag} [1/3] ✅ UNIPILE FETCH OK — ${fetchMs}ms. name="${profileData.first_name || ""} ${profileData.last_name || ""}" headline="${(profileData.headline || "").slice(0, 60)}"`);
    } catch (fetchErr: any) {
      console.error(`${tag} [1/3] ❌ UNIPILE FETCH FAILED after ${Date.now() - fetchStart}ms — ${fetchErr.name}: ${fetchErr.message}`);
      throw fetchErr;
    }

    // ── Stage 2: Persist candidate profile ──
    console.log(`${tag} [1/3] 💾 Saving candidate profile to DB...`);
    const dbSaveStart = Date.now();
    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        linkedinUrl: task.url,
        name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
        headline: profileData.headline || "",
        location: profileData.location || "",
        rawProfile: JSON.stringify(profileData),
      },
    });
    console.log(`${tag} [1/3] 💾 DB save OK — ${Date.now() - dbSaveStart}ms. candidateId=${candidateProfile.id.slice(-6)}`);

    // ── Stage 3: AI analysis (optional) ──
    let analysisResultJson: string | null = null;
    const jobConfig = await getJobConfig(task.jobId);

    if (!jobConfig) {
      console.warn(`${tag} [2/3] ⚠️ No job config found for jobId=${task.jobId.slice(-6)} — skipping analysis`);
    } else if (!jobConfig.jobDescription) {
      console.log(`${tag} [2/3] ℹ️ Analysis SKIPPED — no jobDescription in config`);
    } else {
      const analysisStart = Date.now();
      const aiModel = (jobConfig as any).aiModel || "unknown";
      console.log(`${tag} [2/3] 🤖 AI ANALYSIS START — model="${aiModel}" @ ${new Date().toISOString()}`);
      try {
        const analysisResult = await analyzeProfile(profileData, jobConfig);
        const analysisMs = Date.now() - analysisStart;
        analysisResultJson = JSON.stringify(analysisResult);
        console.log(`${tag} [2/3] ✅ AI ANALYSIS OK — ${analysisMs}ms. score=${analysisResult.scorePercent}% (${analysisResult.totalScore}/${analysisResult.maxScore}) → "${analysisResult.recommendation}"`);

        const recordSaveStart = Date.now();
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
        console.log(`${tag} [2/3] 💾 Analysis record saved — ${Date.now() - recordSaveStart}ms`);

        // ── Stage 4: Sheet export (optional) ──
        const sheetUrl = (jobConfig as any).sheetWebAppUrl;
        if (sheetUrl) {
          const minThreshold = (jobConfig as any).minScoreThreshold ?? 0;
          if (analysisResult.scorePercent >= minThreshold) {
            const sheetStart = Date.now();
            console.log(`${tag} [3/3] 📊 SHEET EXPORT START — score ${analysisResult.scorePercent}% >= threshold ${minThreshold}%`);
            const jdTitle = (jobConfig as any).jdTitle || "Bulk Analysis";
            const payload = buildSheetPayload(
              task.url,
              analysisResult,
              jdTitle,
              jobConfig.scoringRules as Record<string, boolean | undefined>,
              jobConfig
            );
            try {
              await exportToSheet(sheetUrl, payload);
              console.log(`${tag} [3/3] ✅ Sheet export OK — ${Date.now() - sheetStart}ms`);
            } catch (sheetErr: any) {
              console.warn(`${tag} [3/3] ⚠️ Sheet export FAILED after ${Date.now() - sheetStart}ms: ${sheetErr.message}`);
            }
          } else {
            console.log(`${tag} [3/3] ℹ️ Sheet export SKIPPED — score ${analysisResult.scorePercent}% < threshold ${minThreshold}%`);
          }
        } else {
          console.log(`${tag} [3/3] ℹ️ Sheet export SKIPPED — no sheetWebAppUrl configured`);
        }
      } catch (analysisErr: any) {
        console.warn(
          `${tag} [2/3] ❌ AI ANALYSIS FAILED after ${Date.now() - analysisStart}ms: ${analysisErr.message}`
        );
      }
    }

    console.log(`${tag} 💾 Marking task DONE in DB...`);
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "DONE",
        result: JSON.stringify(profileData),
        analysisResult: analysisResultJson,
        accountId: account.id,
      },
    });

    if (analysisResultJson) {
      console.log(`${tag} 🎯 Checking auto-shortlist...`);
      await maybeAutoShortlist(task.id, task.jobId, profileData, JSON.parse(analysisResultJson));
    }

    const updatedJob = await prisma.job.update({
      where: { id: task.jobId },
      data: {
        processedCount: { increment: 1 },
        successCount: { increment: 1 },
      },
    });

    if (updatedJob.processedCount >= updatedJob.totalTasks) {
      console.log(`${tag} 🏁 Job ${task.jobId.slice(-6)} COMPLETE! (${updatedJob.processedCount}/${updatedJob.totalTasks})`);
      await prisma.job.update({
        where: { id: task.jobId },
        data: { status: "COMPLETED" },
      });
    }

    success = true;
    console.log(`${tag} ✅ TASK DONE in ${Date.now() - taskStart}ms. Job progress: ${updatedJob.processedCount}/${updatedJob.totalTasks}`);
  } catch (error: any) {
    const elapsed = Date.now() - taskStart;
    if (error instanceof RateLimitError) {
      console.warn(`${tag} ⚠️ RATE LIMITED after ${elapsed}ms — cooling down account. retryAfter=${error.retryAfterMs}ms`);
      await cooldownAccount(account.id);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ServerError || error instanceof NetworkError) {
      console.warn(`${tag} 🔄 RETRYABLE ERROR after ${elapsed}ms (${error.name}): ${error.message}. retry=${task.retryCount + 1}/${CONFIG.MAX_RETRIES}`);
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "PENDING", retryCount: { increment: 1 } },
      });
    } else if (error instanceof ClientError) {
      console.error(`${tag} ❌ CLIENT ERROR after ${elapsed}ms (status=${error.statusCode}): ${error.message}. Marking FAILED.`);
      await markTaskFailed(task.id, task.jobId, error.message);
    } else {
      console.error(`${tag} 💥 UNKNOWN ERROR after ${elapsed}ms — ${error.name}: ${error.message}`);
      console.error(`${tag}    Stack: ${error.stack?.split("\n").slice(0, 3).join(" | ")}`);
      if (task.retryCount >= CONFIG.MAX_RETRIES) {
        console.error(`${tag} ❌ Exhausted retries (${task.retryCount}/${CONFIG.MAX_RETRIES}). Marking FAILED.`);
        await markTaskFailed(
          task.id,
          task.jobId,
          `Exhausted retries: ${error.message || "Unknown error"}`
        );
      } else {
        console.warn(`${tag} 🔄 Retrying (${task.retryCount + 1}/${CONFIG.MAX_RETRIES})...`);
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "PENDING", retryCount: { increment: 1 } },
        });
      }
    }
  } finally {
    console.log(`${tag} 🔓 Releasing account ${account.id.slice(-6)} (success=${success})...`);
    await releaseAccount(account.id, success).catch((err) => {
      console.error(`${tag} 🚨 CRITICAL: Failed to release account ${account.id} — it will stay BUSY until stale recovery: ${err.message}`);
    });
    console.log(`${tag} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  }
}

// ─── Resume Task Processor (no Unipile account needed) ────────────────────────────

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
  }
): Promise<void> {
  const tag = `[ResumeTask ${task.id.slice(-6)}]`;

  // Optimistic claim — only succeed if still PENDING
  const claimed = await prisma.task
    .update({
      where: { id: task.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    })
    .catch(() => null);

  if (!claimed) {
    console.log(`${tag} Claim failed — already grabbed by another worker.`);
    return;
  }

  console.log(`${tag} Claimed resume task: ${task.sourceFileName || task.url}`);

  if (task.job.status === "CANCELLED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "FAILED", errorMessage: "Job was cancelled" } });
    await updateJobProgress(task.jobId, false);
    return;
  }

  if (task.job.status === "PAUSED") {
    await prisma.task.update({ where: { id: task.id }, data: { status: "PENDING" } });
    return;
  }

  // Ensure job is PROCESSING
  if (task.job.status === "PENDING") {
    await prisma.job
      .update({ where: { id: task.job.id, status: "PENDING" }, data: { status: "PROCESSING" } })
      .catch(() => {});
  }

  try {
    // Parse pre-stored resume text
    let preloaded: any = null;
    try {
      preloaded = task.result ? JSON.parse(task.result) : null;
    } catch { /* ignore JSON parse errors */ }

    if (!preloaded?.resumeText) {
      console.error(`${tag} No resumeText found in task.result — marking failed.`);
      await prisma.task.update({ where: { id: task.id }, data: { status: "FAILED", errorMessage: "No extracted text available" } });
      await updateJobProgress(task.jobId, false);
      return;
    }

    const jobConfig = await getJobConfig(task.jobId);

    if (!jobConfig?.jobDescription) {
      // No JD configured — mark done without analysis (user can re-run after setting JD)
      console.log(`${tag} No JD configured — marking DONE without analysis.`);
      await prisma.task.update({ where: { id: task.id }, data: { status: "DONE" } });
      await updateJobProgress(task.jobId, true);
      return;
    }

    const analysisStart = Date.now();
    console.log(`${tag} Running AI analysis on resume text (${preloaded.resumeText.length} chars)...`);

    const analysisResult = await analyzeProfile(preloaded, jobConfig);
    const analysisResultJson = JSON.stringify(analysisResult);

    console.log(`${tag} Analysis OK — ${Date.now() - analysisStart}ms. score=${analysisResult.scorePercent}% → ${analysisResult.recommendation}`);

    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "DONE",
        analysisResult: analysisResultJson,
        // result column keeps the resumeText so the UI can display the source
      },
    });

    await updateJobProgress(task.jobId, true);

    // Auto-shortlist if an active campaign threshold is met
    await maybeAutoShortlist(task.id, task.jobId, preloaded, analysisResult);

    // Sheet export (if configured)
    const sheetUrl = (jobConfig as any).sheetWebAppUrl;
    if (sheetUrl) {
      const { exportToSheet, buildSheetPayload } = await import("@/lib/sheets");
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
    await prisma.task.update({
      where: { id: task.id },
      data: { status: "FAILED", errorMessage: err.message || "Analysis failed" },
    });
    await updateJobProgress(task.jobId, false);
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
    console.log(`[Process] 🔧 Recovery: ${recovery.recoveredTasks} stale tasks reset, ${recovery.checkedAccounts} BUSY accounts checked`);
  }

  // Clean up PENDING tasks belonging to CANCELLED jobs (can accumulate if cancel
  // happened before this fix was deployed).
  const orphaned = await prisma.task.updateMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      job: { status: "CANCELLED" },
    },
    data: { status: "FAILED", errorMessage: "Job was cancelled" },
  });
  if (orphaned.count > 0) {
    console.log(`[Process] 🧹 Cleaned up ${orphaned.count} orphaned tasks from CANCELLED jobs`);
  }

  // 1. Drain resume/zip tasks — no Unipile accounts needed
  const resumeTasks = await prisma.task.findMany({
    where: {
      status: "PENDING",
      source: { in: ["resume", "zip_import"] },
      job: {
        status: { notIn: ["PAUSED", "CANCELLED"] },
        requisition: { isActive: true }
      },
    },
    orderBy: [{ retryCount: "asc" }, { createdAt: "asc" }],
    take: 20,
    include: { job: { select: { status: true, id: true } } },
  });

  if (resumeTasks.length > 0) {
    console.log(`[Process] 📄 Found ${resumeTasks.length} PENDING resume tasks — processing without accounts...`);
    await Promise.allSettled(resumeTasks.map((task) => processResumeTask(task as any)));
  } else {
    console.log(`[Process] 📄 No resume/zip tasks pending`);
  }

  // 2. Process LinkedIn tasks
  const concurrency = await getWorkerConcurrency();
  console.log(`[Process] ⚙️ Worker concurrency: ${concurrency}`);

  await logAccountPoolState("before-acquire");

  // Debug: count ALL pending tasks regardless of filter, to detect filter mismatches
  const allPendingCount = await prisma.task.count({ where: { status: "PENDING" } });
  const linkedinPendingCount = await prisma.task.count({ where: { status: "PENDING", source: "linkedin_url" } });
  console.log(`[Process] 📊 DB task counts — allPending=${allPendingCount} linkedinPending=${linkedinPendingCount}`);

  if (allPendingCount > linkedinPendingCount) {
    const otherSources = await prisma.task.groupBy({
      by: ["source"],
      where: { status: "PENDING" },
      _count: true,
    });
    console.log(`[Process] 📊 Pending by source: ${JSON.stringify(otherSources)}`);
  }

  const pendingTasks = await prisma.task.findMany({
    where: {
      status: "PENDING",
      source: "linkedin_url",
      job: {
        status: { notIn: ["PAUSED", "CANCELLED"] },
        requisition: { isActive: true }
      },
    },
    orderBy: [{ retryCount: "asc" }, { createdAt: "asc" }],
    take: concurrency,
    include: { job: { select: { status: true, id: true } } },
  });

  if (pendingTasks.length === 0) {
    const processingCount = await prisma.task.count({ where: { status: "PROCESSING" } });
    console.log(`[Process] ℹ️ No PENDING linkedin_url tasks found (filter: notIn[PAUSED,CANCELLED] + isActive=true). PROCESSING in-flight: ${processingCount}`);

    // Extra debug: check if tasks exist but are filtered out by job status or requisition
    if (linkedinPendingCount > 0) {
      const filteredOut = await prisma.task.findMany({
        where: { status: "PENDING", source: "linkedin_url" },
        select: { id: true, jobId: true, job: { select: { status: true, requisitionId: true, requisition: { select: { isActive: true } } } } },
        take: 5,
      });
      console.warn(`[Process] ⚠️ ${linkedinPendingCount} linkedin tasks are PENDING but filtered out — samples:`);
      for (const t of filteredOut) {
        console.warn(`[Process]   taskId=${t.id.slice(-6)} jobStatus="${t.job.status}" requisitionId=${t.job.requisitionId?.slice(-6) ?? "NULL"} isActive=${t.job.requisition?.isActive ?? "NULL"}`);
      }
    }

    return { processed: resumeTasks.length, succeeded: 0, failed: 0, remaining: 0 };
  }

  console.log(`[Process] 🔍 Found ${pendingTasks.length} PENDING linkedin_url tasks. Acquiring accounts...`);

  const accounts = await acquireAccounts(pendingTasks.length);

  await logAccountPoolState("after-acquire");

  if (accounts.length === 0) {
    const remaining = await prisma.task.count({ where: { status: "PENDING" } });
    console.warn(`[Process] 🚨 NO ACCOUNTS AVAILABLE — ${remaining} tasks stuck waiting.`);
    console.warn(`[Process]    → Go to Settings > Accounts and check that at least one Unipile account is configured with status ACTIVE.`);
    console.warn(`[Process]    → Also verify UNIPILE_DSN and UNIPILE_API_KEY env vars are set if using env-level credentials.`);
    return { processed: resumeTasks.length, succeeded: 0, failed: 0, remaining };
  }

  const pairs = pendingTasks
    .slice(0, accounts.length)
    .map((task, i) => ({ task, account: accounts[i] }));

  for (let i = pairs.length; i < accounts.length; i++) {
    console.log(`[Process] 🔓 Releasing surplus account ${accounts[i].id.slice(-6)}`);
    await releaseAccount(accounts[i].id, false);
  }

  console.log(`[Process] 🚀 Dispatching ${pairs.length} tasks in parallel (wanted ${pendingTasks.length}, got ${accounts.length} accounts)...`);

  const results = await Promise.allSettled(
    pairs.map(({ task, account }) => processOneTask(task, account))
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;
  const remaining = await prisma.task.count({ where: { status: "PENDING" } });

  console.log(`[Process] ✅ Cycle complete in ${Date.now() - cycleStart}ms — dispatched=${pairs.length} settled_ok=${succeeded} settled_err=${failed} remaining=${remaining}`);

  return { processed: resumeTasks.length + pairs.length, succeeded, failed, remaining };
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
  const hasSecret = !!process.env.CRON_SECRET;
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  console.log(`[Process] 📥 POST received — env=${process.env.NODE_ENV} CRON_SECRET=${hasSecret} authMatch=${isAuthed}`);

  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    !isAuthed
  ) {
    console.error(`[Process] 🔒 UNAUTHORIZED — Bearer token mismatch. Request will be rejected.`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Process] ✅ Auth OK — starting processLoop directly (no after())");

  // Run processLoop without after() — after() silently drops in some environments.
  // Fire-and-forget so the HTTP 200 returns immediately while processing continues.
  const t = Date.now();
  processLoop()
    .then(() => console.log(`[Process] processLoop finished in ${Date.now() - t}ms`))
    .catch((err: any) => console.error("[Process] 💥 processLoop crashed:", err.message, err.stack));

  return NextResponse.json({ message: "Processing started" });
}

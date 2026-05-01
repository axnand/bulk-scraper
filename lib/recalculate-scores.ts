import { prisma } from "@/lib/prisma";
import { getEffectiveRules } from "@/lib/analyzer";

// ─── Shared score computation ───────────────────────────────────────────────

export interface RecomputeResult {
  totalScore: number;
  maxScore: number;
  scorePercent: number;
  recommendation: string;
  unscoredRules: Array<{ key: string; label: string }>;
}

/**
 * Recomputes totals from raw analysisData.scoring using the current enabled rules.
 * Applies HR overrides on top of AI scores.
 * Rules whose parameter keys are absent from analysisData.scoring are excluded from
 * maxScore and flagged in unscoredRules (avoids penalising old candidates for new rules).
 */
export function recomputeTaskScore(
  analysisData: any,
  effectiveRules: Array<{ key: string; label: string; enabled: boolean; scoreParameters: Array<{ key: string; maxPoints: number }> }>,
  overrideMap: Map<string, number> = new Map()
): RecomputeResult {
  const scoring: Record<string, number> = analysisData?.scoring || {};
  const activeRules = effectiveRules.filter(r => r.enabled);

  let totalScore = 0;
  let maxScore = 0;
  const unscoredRules: Array<{ key: string; label: string }> = [];

  for (const rule of activeRules) {
    const hasData = rule.scoreParameters.some(p => p.key in scoring || overrideMap.has(p.key));
    if (!hasData) {
      unscoredRules.push({ key: rule.key, label: rule.label });
      continue;
    }

    const ruleMax = Math.max(0, ...rule.scoreParameters.map(p => p.maxPoints));
    maxScore += ruleMax;

    let bestRuleScore = 0;
    for (const p of rule.scoreParameters) {
      const val = overrideMap.has(p.key) ? overrideMap.get(p.key)! : (scoring[p.key] ?? 0);
      if (typeof val === "number" && val > bestRuleScore) {
        bestRuleScore = val;
      }
    }
    totalScore += bestRuleScore;
  }

  const scorePercent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  let recommendation = "Not a Fit";
  if (scorePercent >= 70) recommendation = "Strong Fit";
  else if (scorePercent >= 40) recommendation = "Moderate Fit";

  return { totalScore, maxScore, scorePercent, recommendation, unscoredRules };
}

// ─── Requisition-level batch recalculation ──────────────────────────────────

export async function recalculateScoresForRequisition(requisitionId: string, config: any) {
  console.log(`[RecalculateScores] Starting for requisition ${requisitionId}`);

  const tasks = await prisma.task.findMany({
    where: {
      job: { requisitionId },
      status: "DONE",
      analysisResult: { not: null },
    },
    select: {
      id: true,
      url: true,
      analysisResult: true,
      job: { select: { config: true } },
      overrides: { select: { paramKey: true, override: true } },
    },
  });

  if (tasks.length === 0) {
    console.log(`[RecalculateScores] No completed tasks found`);
    return;
  }

  console.log(`[RecalculateScores] Processing ${tasks.length} tasks`);

  for (const task of tasks) {
    let analysisData: any;
    try {
      analysisData = JSON.parse(task.analysisResult!);
    } catch {
      continue;
    }

    // Resolve rules from the job's config snapshot (defines the scoring universe),
    // then apply the live enabled/disabled flags from the current requisition config.
    const jobConfig = task.job.config ? JSON.parse(task.job.config) : {};
    const effectiveRules = getEffectiveRules({
      scoringRules: config.scoringRules,
      customScoringRules: config.customScoringRules,
      builtInRuleDescriptions: jobConfig.builtInRuleDescriptions,
      ruleDefinitions: jobConfig.ruleDefinitions,
    });

    const overrideMap = new Map(task.overrides.map(o => [o.paramKey, o.override]));
    const result = recomputeTaskScore(analysisData, effectiveRules, overrideMap);

    analysisData.totalScore = result.totalScore;
    analysisData.maxScore = result.maxScore;
    analysisData.scorePercent = result.scorePercent;
    analysisData.recommendation = result.recommendation;
    analysisData.unscoredRules = result.unscoredRules;
    analysisData.hasOverrides = task.overrides.length > 0;

    const updatedJson = JSON.stringify(analysisData);

    // Task.analysisResult is the primary source of truth for the UI
    await prisma.task.update({
      where: { id: task.id },
      data: { analysisResult: updatedJson },
    });

    // Best-effort AnalysisRecord sync — not read by the UI, failures are non-fatal
    try {
      const jobDescription = config.jobDescription || jobConfig.jobDescription;
      if (task.url && jobDescription) {
        const record = await prisma.analysisRecord.findFirst({
          where: { linkedinUrl: task.url, jobDescription },
          orderBy: { id: "desc" },
          select: { id: true },
        });
        if (record) {
          await prisma.analysisRecord.update({
            where: { id: record.id },
            data: {
              totalScore: result.totalScore,
              maxScore: result.maxScore,
              scorePercent: result.scorePercent,
              recommendation: result.recommendation,
              analysisData: updatedJson,
              scoringConfig: JSON.stringify({
                scoringRules: config.scoringRules,
                customScoringRules: config.customScoringRules,
                aiModel: config.aiModel,
                customPrompt: config.customPrompt,
              }),
            },
          });
        }
      }
    } catch {
      // AnalysisRecord update failed — Task already updated, so UI is consistent
    }
  }

  console.log(`[RecalculateScores] Completed for requisition ${requisitionId}`);
}

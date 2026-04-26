import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveRules } from "@/lib/analyzer";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const overrides = await prisma.scoreOverride.findMany({
      where: { taskId },
    });
    return NextResponse.json({ overrides });
  } catch (error) {
    console.error("[Overrides] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await req.json();
    const { paramKey, ruleKey, override, reason, author } = body;

    if (!paramKey || !ruleKey || typeof override !== "number" || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { job: true },
    });

    if (!task || !task.analysisResult) {
      return NextResponse.json({ error: "Task or analysis not found" }, { status: 404 });
    }

    const analysis = JSON.parse(task.analysisResult);
    const original = typeof analysis.scoring[paramKey] === "number" ? analysis.scoring[paramKey] : 0;

    // Upsert the override
    await prisma.scoreOverride.upsert({
      where: { taskId_paramKey: { taskId, paramKey } },
      update: { override, reason, author: author || "HR", original },
      create: { taskId, paramKey, ruleKey, override, reason, author: author || "HR", original },
    });

    // Recalculate scores
    const updatedAnalysis = await recalculateTaskScore(taskId, task, analysis);

    return NextResponse.json({ ok: true, analysisResult: updatedAnalysis });
  } catch (error) {
    console.error("[Overrides] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { searchParams } = new URL(req.url);
    const paramKey = searchParams.get("paramKey");

    if (!paramKey) {
      return NextResponse.json({ error: "Missing paramKey" }, { status: 400 });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { job: true },
    });

    if (!task || !task.analysisResult) {
      return NextResponse.json({ error: "Task or analysis not found" }, { status: 404 });
    }

    await prisma.scoreOverride.delete({
      where: { taskId_paramKey: { taskId, paramKey } },
    });

    const analysis = JSON.parse(task.analysisResult);
    const updatedAnalysis = await recalculateTaskScore(taskId, task, analysis);

    return NextResponse.json({ ok: true, analysisResult: updatedAnalysis });
  } catch (error) {
    console.error("[Overrides] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function recalculateTaskScore(taskId: string, task: any, analysis: any) {
  // Get all current overrides
  const overrides = await prisma.scoreOverride.findMany({ where: { taskId } });
  const overrideMap = new Map(overrides.map(o => [o.paramKey, o.override]));

  const config = task.job.config ? JSON.parse(task.job.config) : {};
  const effectiveRules = getEffectiveRules({
    scoringRules: config.scoringRules,
    customScoringRules: config.customScoringRules,
    builtInRuleDescriptions: config.builtInRuleDescriptions,
    ruleDefinitions: config.ruleDefinitions,
  });

  const activeRules = effectiveRules.filter(r => r.enabled);
  const maxScore = activeRules.reduce((sum, rule) => {
    return sum + Math.max(0, ...rule.scoreParameters.map(p => p.maxPoints));
  }, 0);

  let totalScore = 0;
  for (const rule of activeRules) {
    let bestRuleScore = 0;
    for (const p of rule.scoreParameters) {
      // Use override if exists, else original
      const val = overrideMap.has(p.key) ? overrideMap.get(p.key)! : (analysis.scoring[p.key] || 0);
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

  analysis.totalScore = totalScore;
  analysis.maxScore = maxScore;
  analysis.scorePercent = scorePercent;
  analysis.recommendation = recommendation;
  analysis.hasOverrides = overrides.length > 0;

  // Save back to Task and AnalysisRecord (if exists)
  await prisma.task.update({
    where: { id: taskId },
    data: { analysisResult: JSON.stringify(analysis) }
  });

  // Note: we also need to update CandidateProfile -> AnalysisRecord if it exists
  // For the UI, updating the task is enough, but to be safe we update AnalysisRecord too if possible.
  if (task.url) {
    const record = await prisma.analysisRecord.findFirst({
      where: { linkedinUrl: task.url, jobDescription: config.jobDescription },
      orderBy: { id: 'desc' }
    });
    if (record) {
      await prisma.analysisRecord.update({
        where: { id: record.id },
        data: {
          totalScore,
          maxScore,
          scorePercent,
          recommendation,
          analysisData: JSON.stringify(analysis)
        }
      });
    }
  }

  return analysis;
}

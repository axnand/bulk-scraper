import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveRules } from "@/lib/analyzer";
import { recomputeTaskScore } from "@/lib/recalculate-scores";

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
    const original = typeof analysis.scoring?.[paramKey] === "number" ? analysis.scoring[paramKey] : 0;

    await prisma.scoreOverride.upsert({
      where: { taskId_paramKey: { taskId, paramKey } },
      update: { override, reason, author: author || "HR", original },
      create: { taskId, paramKey, ruleKey, override, reason, author: author || "HR", original },
    });

    const updatedAnalysis = await applyOverridesAndSave(taskId, task, analysis);
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
    const updatedAnalysis = await applyOverridesAndSave(taskId, task, analysis);
    return NextResponse.json({ ok: true, analysisResult: updatedAnalysis });
  } catch (error) {
    console.error("[Overrides] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function applyOverridesAndSave(taskId: string, task: any, analysis: any) {
  const overrides = await prisma.scoreOverride.findMany({ where: { taskId } });
  const overrideMap = new Map(overrides.map(o => [o.paramKey, o.override]));

  const config = task.job.config ? JSON.parse(task.job.config) : {};
  const effectiveRules = getEffectiveRules({
    scoringRules: config.scoringRules,
    customScoringRules: config.customScoringRules,
    builtInRuleDescriptions: config.builtInRuleDescriptions,
    ruleDefinitions: config.ruleDefinitions,
  });

  const result = recomputeTaskScore(analysis, effectiveRules, overrideMap);

  analysis.totalScore = result.totalScore;
  analysis.maxScore = result.maxScore;
  analysis.scorePercent = result.scorePercent;
  analysis.recommendation = result.recommendation;
  analysis.unscoredRules = result.unscoredRules;
  analysis.hasOverrides = overrides.length > 0;

  await prisma.task.update({
    where: { id: taskId },
    data: { analysisResult: JSON.stringify(analysis) },
  });

  if (task.url) {
    const record = await prisma.analysisRecord.findFirst({
      where: { linkedinUrl: task.url, jobDescription: config.jobDescription },
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
          analysisData: JSON.stringify(analysis),
        },
      });
    }
  }

  return analysis;
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.evaluationConfig.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { error: "Cannot edit the system default config" },
        { status: 400 }
      );
    }

    const body = await req.json();

    const parseJson = (val: string | null, fallback: any) => {
      if (!val) return fallback;
      try { return JSON.parse(val); } catch { return fallback; }
    };

    const toJsonOrNull = (val: any) =>
      val && typeof val === "object" && Object.keys(val).length > 0
        ? JSON.stringify(val)
        : null;

    const config = await prisma.evaluationConfig.update({
      where: { id },
      data: {
        ...(body.title != null && { title: body.title.trim() }),
        ...(body.promptRole !== undefined && { promptRole: body.promptRole || null }),
        ...(body.criticalInstructions !== undefined && { criticalInstructions: body.criticalInstructions || null }),
        ...(body.promptGuidelines !== undefined && { promptGuidelines: body.promptGuidelines || null }),
        ...(body.builtInRuleDescriptions !== undefined && {
          builtInRuleDescriptions: toJsonOrNull(body.builtInRuleDescriptions),
        }),
        ...(body.scoringRules !== undefined && {
          scoringRules: body.scoringRules ? JSON.stringify(body.scoringRules) : null,
        }),
        ...(body.customScoringRules !== undefined && {
          customScoringRules: body.customScoringRules ? JSON.stringify(body.customScoringRules) : null,
        }),
        ...(body.ruleDefinitions !== undefined && {
          ruleDefinitions: toJsonOrNull(body.ruleDefinitions),
        }),
        ...(body.promptEnvelope !== undefined && {
          promptEnvelope: toJsonOrNull(body.promptEnvelope),
        }),
      },
    });

    return NextResponse.json({
      id: config.id,
      title: config.title,
      isDefault: config.isDefault,
      promptRole: config.promptRole,
      criticalInstructions: config.criticalInstructions,
      promptGuidelines: config.promptGuidelines,
      builtInRuleDescriptions: parseJson(config.builtInRuleDescriptions, {}),
      scoringRules: parseJson(config.scoringRules, null),
      customScoringRules: parseJson(config.customScoringRules, []),
      ruleDefinitions: parseJson(config.ruleDefinitions, {}),
      promptEnvelope: parseJson(config.promptEnvelope, {}),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }
    console.error("Error updating evaluation config:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.evaluationConfig.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { error: "Cannot delete the system default config" },
        { status: 400 }
      );
    }

    await prisma.evaluationConfig.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }
    console.error("Error deleting evaluation config:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

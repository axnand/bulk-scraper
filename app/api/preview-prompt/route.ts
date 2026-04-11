import { NextRequest, NextResponse } from "next/server";
import { buildSystemPrompt } from "@/lib/analyzer";
import type { ScoringRules, CustomScoringRule } from "@/lib/analyzer";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const scoringRules: ScoringRules = body.scoringRules || {};
    const customScoringRules: CustomScoringRule[] =
      body.customScoringRules || [];

    const systemPrompt = buildSystemPrompt(scoringRules, customScoringRules, {
      customPrompt: body.customPrompt || undefined,
      promptRole: body.promptRole || undefined,
      promptGuidelines: body.promptGuidelines || undefined,
      criticalInstructions: body.criticalInstructions || undefined,
      builtInRuleDescriptions: body.builtInRuleDescriptions || undefined,
    });

    return NextResponse.json({
      systemPrompt,
      charCount: systemPrompt.length,
    });
  } catch (error) {
    console.error("Error building preview prompt:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

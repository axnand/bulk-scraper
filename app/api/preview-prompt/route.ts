import { NextRequest, NextResponse } from "next/server";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/analyzer";
import type { ScoringRules, CustomScoringRule, CandidateInfo } from "@/lib/analyzer";

const PLACEHOLDER_PROFILE = {
  first_name: "[Candidate",
  last_name: "Name]",
  headline: "[Candidate Headline]",
  location: "[Candidate Location]",
  summary: "",
  work_experience: [],
  education: [],
  skills: [],
  certifications: [],
};

const PLACEHOLDER_CANDIDATE_INFO: CandidateInfo = {
  name: "[Candidate Name]",
  btech: "",
  graduation: "",
  mba: "",
  currentOrg: "[Current Company]",
  currentDesignation: "[Current Role]",
  totalExperienceYears: 0,
  companiesSwitched: 0,
  stabilityAvgYears: 0,
  currentLocation: "",
  graduationYear: null,
};

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
      ruleDefinitions: body.ruleDefinitions || undefined,
      promptEnvelope: body.promptEnvelope || undefined,
    });

    let userPrompt: string | null = null;
    if (body.jobDescription?.trim()) {
      userPrompt = buildUserPrompt(
        PLACEHOLDER_PROFILE,
        body.jobDescription,
        PLACEHOLDER_CANDIDATE_INFO
      );
    }

    return NextResponse.json({
      systemPrompt,
      userPrompt,
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

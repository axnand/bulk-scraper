import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRequisitionId } from "@/lib/resolve-requisition";
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

    let scoringRules: ScoringRules = body.scoringRules || {};
    let customScoringRules: CustomScoringRule[] = body.customScoringRules || [];
    let builtInRuleDescriptions = body.builtInRuleDescriptions;
    let ruleDefinitions = body.ruleDefinitions;
    let promptEnvelope = body.promptEnvelope;

    // When a requisitionId is provided, always pull scoring config straight from the DB
    // so the preview reflects the latest saved state regardless of client staleness.
    if (body.requisitionId) {
      try {
        const reqId = await resolveRequisitionId(body.requisitionId);
        const requisition = await prisma.requisition.findUnique({ where: { id: reqId } });
        if (requisition?.config) {
          const dbCfg = JSON.parse(requisition.config);
          scoringRules = dbCfg.scoringRules ?? scoringRules;
          customScoringRules = dbCfg.customScoringRules ?? customScoringRules;
          builtInRuleDescriptions = dbCfg.builtInRuleDescriptions ?? builtInRuleDescriptions;
          ruleDefinitions = dbCfg.ruleDefinitions ?? ruleDefinitions;
          promptEnvelope = dbCfg.promptEnvelope ?? promptEnvelope;
        }
      } catch (e) {
        console.warn("[preview-prompt] Failed to load requisition config, falling back to body:", e);
      }
    }

    const systemPrompt = buildSystemPrompt(scoringRules, customScoringRules, {
      customPrompt: body.customPrompt || undefined,
      promptRole: body.promptRole || undefined,
      promptGuidelines: body.promptGuidelines || undefined,
      criticalInstructions: body.criticalInstructions || undefined,
      builtInRuleDescriptions: builtInRuleDescriptions || undefined,
      ruleDefinitions: ruleDefinitions || undefined,
      promptEnvelope: promptEnvelope || undefined,
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

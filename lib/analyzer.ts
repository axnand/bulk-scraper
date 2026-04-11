import { chatCompletion } from "@/lib/ai-adapter";

/**
 * Profile Analyzer — Ported from linkedInScraper Chrome Extension
 *
 * This module evaluates a LinkedIn profile against a Job Description
 * using an 85-point scoring rubric with 7 configurable dimensions.
 *
 * Flow:
 *   1. Deterministic pre-computation (stability, location, candidate info)
 *   2. LLM evaluation via OpenAI for remaining dimensions
 *   3. Merge both into a final scored result
 */

// ─── Types ─────────────────────────────────────────────────────────

export interface ScoringRules {
  stability?: boolean;
  growth?: boolean;
  graduation?: boolean;
  companyType?: boolean;
  mba?: boolean;
  skillMatch?: boolean;
  location?: boolean;
}

export interface CustomScoringRule {
  id: string;
  name: string;
  maxPoints: number;
  criteria: string;
  enabled: boolean;
}

export interface AnalysisConfig {
  jobDescription: string;
  customPrompt?: string;
  scoringRules?: ScoringRules;
  customScoringRules?: CustomScoringRule[];
  aiModel?: string;
  aiProviderId?: string;
  /** User-defined AI evaluator identity. Replaces the default "You are a strict ATS evaluator..." header. */
  promptRole?: string;
  /** User-defined evaluation guidelines. Injected after the critical instructions block. */
  promptGuidelines?: string;
  /** Override the default CRITICAL INSTRUCTIONS behavioral rules block. */
  criticalInstructions?: string;
  /** Override individual built-in rule descriptions. Keyed by rule ID (growth, graduation, etc.). */
  builtInRuleDescriptions?: Record<string, string>;
}

export interface CandidateInfo {
  name: string;
  btech: string;
  graduation: string;
  mba: string;
  currentOrg: string;
  currentDesignation: string;
  totalExperienceYears: number;
  companiesSwitched: number;
  stabilityAvgYears: number;
  currentLocation: string;
  graduationYear: number | null;
}

export interface CareerStats {
  distinctCompanyCount: number;
  companyTenures: Record<string, number>;
  averageTenureYears: number;
  averageTenureMonths: number;
  stabilityScore: number;
  totalExperienceYears: number;
  jobSwitchCount: number;
}

export interface AnalysisResult {
  candidateInfo: CandidateInfo;
  scoring: Record<string, number | string>;
  scoringLogs: Record<string, string>;
  maxScore: number;
  totalScore: number;
  scorePercent: number;
  recommendation: string;
  customScoringRules: CustomScoringRule[];
  remarks: string;
  experienceSummary: string;
  skillBreakdown: {
    matchedSkills: string[];
    missingSkills: string[];
    matchPercent: number;
  } | null;
  strengths: string[];
  gaps: string[];
  flags: string[];
  __debug?: {
    systemPrompt: string;
    userPrompt: string;
    model: string;
    usage: any;
    preComputed: Record<string, any>;
  };
}

// ─── Constants ─────────────────────────────────────────────────────

const BTECH_KEYWORDS = [
  "b.tech", "btech", "b tech", "bachelor of technology",
  "b.e.", "b.e", "bachelor of engineering",
];

const MBA_KEYWORDS = [
  "mba", "pgdm", "master of business administration",
  "post graduate diploma in management",
];

const LLM_RULE_POINTS: Record<string, number> = {
  growth: 15,
  graduation: 15,
  companyType: 15,
  mba: 15,
  skillMatch: 10,
};

const PRE_COMPUTED_POINTS: Record<string, number> = {
  stability: 10,
  location: 5,
};

const RULE_POINTS: Record<string, number> = {
  ...PRE_COMPUTED_POINTS,
  ...LLM_RULE_POINTS,
};

// ─── LLM Rule Prompt Blocks ───────────────────────────────────────

export const DEFAULT_RULE_PROMPTS: Record<string, string> = {
  growth: `GROWTH (Max: 15) — MUTUALLY EXCLUSIVE. Evaluate ONLY full-time roles. IGNORE internships, trainee positions, and part-time roles entirely — they do not exist for this evaluation.

   USE THIS SENIORITY LADDER TO COMPARE TITLES (lowest → highest):
   Executive/Associate → Senior Executive/Specialist → Lead/Team Lead → Manager/Assistant Manager → Senior Manager → Director/AVP → VP/Head → CXO/Partner

   RULES:
   - Internal promotion = moved UP at least one seniority level within the SAME company (e.g. "Sales Executive" → "Senior Sales Executive" at same company). A mere title variation without level change (e.g. "Sales Executive" → "Sales Executive - Key Accounts") is NOT a promotion.
   - External growth = joined a NEW company at a HIGHER seniority level than the previous full-time role (e.g. "Senior Executive at Company A" → "Manager at Company B").
   - Lateral move = same seniority level at a different company or different function at same level. This is NOT growth.

   SCORING:
   - Internal promotion found → promotionSameCompany=15, promotionWithChange=""
   - Only external growth found (no internal promotion) → promotionSameCompany="", promotionWithChange=10
   - BOTH internal AND external → promotionSameCompany=15, promotionWithChange=""
   - NEITHER (no clear upward movement, or insufficient data) → both ""`,

  graduation: `GRADUATION (Max: 15) — MUTUALLY EXCLUSIVE — Evaluate ONLY the UNDERGRADUATE degree. Do NOT use the MBA/PGDM institution here — MBA is scored separately.

   YOU MUST FOLLOW THESE TWO STEPS IN ORDER:

   STEP 1 — CLASSIFY THE DEGREE TYPE:
   - "BTech/BE-equivalent" means ONLY: BTech, B.Tech, BE, B.E., BS/BSc in Computer Science or Engineering (4-year engineering/technology degrees).
   - "Non-BTech" means ALL other undergrad degrees: BCA, BBA, BCom, BA, BSc (non-CS/non-engineering), B.Sc IT, BMS, Management, Finance, Arts, etc. These are NOT equivalent to BTech/BE even if the institution is prestigious. A Bachelor of Management is Non-BTech. A Bachelor of Commerce is Non-BTech.

   STEP 2 — CLASSIFY THE INSTITUTION TIER, THEN LOOK UP SCORE:
   Use your knowledge to classify the UNDERGRADUATE institution as Tier 1 (premier national/global institutions), Tier 2 (well-known reputable institutions), or neither. Do NOT use the MBA institution for this rule.

   SCORE LOOKUP TABLE (degree type × institution tier):
   | Degree Type  | Tier 1 Institution | Tier 2 Institution | Neither |
   |-------------|-------------------|-------------------|---------|
   | BTech/BE    | gradTier1=15      | gradTier2=10      | both "" |
   | Non-BTech   | gradTier1=7       | gradTier2=5       | both "" |

   IMPORTANT: Non-BTech from Tier 2 is ALWAYS 5, never 10. Only BTech/BE from Tier 2 gets 10. If the degree is BBA, BCom, BMS, Management, Finance, or anything other than BTech/BE/BS-Engineering, the maximum possible Tier 2 score is 5.`,

  companyType: `COMPANY TYPE (Max: 15) — MUTUALLY EXCLUSIVE, based on CURRENT/most recent company
   - Product B2B Retail/CRM/SalesTech company → salesCRM=15, otherB2B=""
   - Product B2B SaaS non-CRM (cloud, infra, developer tools, data platforms, HR tech, fintech B2B, AI/ML platforms, cybersecurity, analytics) → salesCRM="", otherB2B=10
   - Service-based/IT consulting company → salesCRM="", otherB2B=7
   - Product B2C or unrelated → both ""
   Use your knowledge to classify the company. If the company name or candidate's role strongly implies a B2B SaaS product company (e.g. selling software to businesses), classify it as B2B SaaS even if you are not 100% familiar with the company. Do NOT default to 0 when there is reasonable evidence — score based on the best available classification.
   Examples for reference only: Salesforce/HubSpot/Zoho/Freshworks = B2B SalesTech/CRM, AWS/Atlassian/Datadog/Snowflake/Darktrace/FieldAssist/LeadSquared = B2B SaaS non-CRM, TCS/Infosys/Wipro/Accenture = Service-based, Swiggy/Netflix/Zomato = B2C.`,

  mba: `MBA (Max: 15) — MUTUALLY EXCLUSIVE
   - MBA/PGDM from Tier 1 institution → mbaA=15, mbaOthers=""
   - MBA/PGDM from other institution → mbaA="", mbaOthers=10
   - No MBA/PGDM → both ""
   Use your knowledge to classify the MBA institution as Tier 1 (premier national/global business schools) or other.`,

  skillMatch: `SKILLSET MATCH (Max: 10) — First extract the KEY SKILLS/COMPETENCIES required by the Job Description (e.g. lead generation, CRM, B2B SaaS, ABM, sales tools, domain expertise, languages, certifications, etc.). Then check which of those JD-required skills the candidate actually possesses based on their experience, education, skills section, and certifications. Do NOT just list the candidate's own LinkedIn skills — compare candidate capabilities against what the JD asks for.
   - >70% of JD-required skills/competencies matched → 10
   - 40-70% matched → 5
   - <40% matched → 0`,
};

// ─── Location Matching (Deterministic) ────────────────────────────

const LOCATION_STOP_WORDS = new Set([
  "area", "region", "metro", "greater", "district", "province", "state",
  "city", "county", "metropolitan", "remote", "hybrid", "onsite", "on-site",
  "based", "office", "hq", "headquarters",
]);

function extractLocationTokens(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s,|/\-–—()]+/)
    .map((t) => t.trim().replace(/[^a-z]/g, ""))
    .filter((t) => t.length > 1 && !LOCATION_STOP_WORDS.has(t));
}

function scoreLocationMatch(candidateLocation: string, jobDescription: string): number {
  if (!candidateLocation || !jobDescription) return 0;

  const jdLocMatch = jobDescription.match(/Location\s*[:：]\s*(.+?)(?:\n|$)/i);
  const jdLocText = jdLocMatch ? jdLocMatch[1] : jobDescription;

  const candidateTokens = extractLocationTokens(candidateLocation);
  const jdTokens = extractLocationTokens(jdLocText);

  if (!candidateTokens.length || !jdTokens.length) return 0;

  for (const token of candidateTokens) {
    if (jdTokens.some((jt) => jt.includes(token) || token.includes(jt))) return 5;
  }
  return 0;
}

// ─── Career Stats Computation (Deterministic) ─────────────────────

function parseMonthYear(start: string | null, end: string | null): { months: number } {
  if (!start) return { months: 0 };
  const parseDate = (s: string) => {
    // Handle "M/D/YYYY" format from Unipile
    const parts = s.split("/");
    if (parts.length === 3) {
      return { month: parseInt(parts[0], 10), year: parseInt(parts[2], 10) };
    }
    return null;
  };

  const startDate = parseDate(start);
  if (!startDate) return { months: 0 };

  let endDate: { month: number; year: number };
  if (end) {
    const parsed = parseDate(end);
    if (parsed) {
      endDate = parsed;
    } else {
      endDate = { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
    }
  } else {
    endDate = { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
  }

  const months = (endDate.year - startDate.year) * 12 + (endDate.month - startDate.month);
  return { months: Math.max(months, 0) };
}

export function computeCareerStats(workExperience: any[]): CareerStats {
  if (!workExperience || workExperience.length === 0) {
    return {
      distinctCompanyCount: 0,
      companyTenures: {},
      averageTenureYears: 0,
      averageTenureMonths: 0,
      stabilityScore: 0,
      totalExperienceYears: 0,
      jobSwitchCount: 0,
    };
  }

  const companyTenureMap: Record<string, number> = {};
  let totalMonths = 0;

  for (const exp of workExperience) {
    const company = (exp.company || "Unknown").trim();
    const { months } = parseMonthYear(exp.start, exp.end);
    totalMonths += months;
    companyTenureMap[company] = (companyTenureMap[company] || 0) + months;
  }

  const companyNames = Object.keys(companyTenureMap);
  const distinctCompanyCount = companyNames.length;
  const avgTenureMonths = distinctCompanyCount > 0
    ? Math.round((totalMonths / distinctCompanyCount) * 10) / 10
    : 0;
  const avgTenureYears = Math.round((avgTenureMonths / 12) * 10) / 10;
  const totalYears = Math.round((totalMonths / 12) * 10) / 10;

  let stabilityScore = 0;
  if (avgTenureYears > 2.5) stabilityScore = 10;
  else if (avgTenureYears >= 1.5) stabilityScore = 7;
  else stabilityScore = 0;

  const companyTenures: Record<string, number> = {};
  for (const [c, m] of Object.entries(companyTenureMap)) {
    companyTenures[c] = Math.round((m / 12) * 10) / 10;
  }

  return {
    distinctCompanyCount,
    companyTenures,
    averageTenureYears: avgTenureYears,
    averageTenureMonths: avgTenureMonths,
    stabilityScore,
    totalExperienceYears: totalYears,
    jobSwitchCount: Math.max(0, distinctCompanyCount - 1),
  };
}

// ─── Candidate Info Extraction (Deterministic) ────────────────────

function extractCandidateInfo(profileData: any): CandidateInfo {
  const education = profileData.education || [];
  const experience = profileData.work_experience || [];

  // Find BTech/BE entry
  let btechStr = "";
  for (const edu of education) {
    const degree = (edu.degree || "").toLowerCase();
    if (BTECH_KEYWORDS.some((k) => degree.includes(k))) {
      btechStr = [edu.school, edu.degree].filter(Boolean).join(", ");
      break;
    }
  }

  // Find MBA/PGDM entry
  let mbaStr = "";
  for (const edu of education) {
    const degree = (edu.degree || "").toLowerCase();
    if (MBA_KEYWORDS.some((k) => degree.includes(k))) {
      mbaStr = [edu.school, edu.degree].filter(Boolean).join(", ");
      break;
    }
  }

  // Current role
  const currentRole = experience[0] || {};

  // Graduation year
  let graduationYear: number | null = null;
  for (const edu of education) {
    const endDate = edu.end;
    if (endDate) {
      const yearMatches = String(endDate).match(/(\d{4})/g);
      if (yearMatches?.length) {
        const lastYear = Math.max(...yearMatches.map(Number));
        if (!graduationYear || lastYear < graduationYear) graduationYear = lastYear;
      }
    }
  }

  // Generic graduation entry (non-MBA, non-BTech)
  let gradStr = "";
  if (!btechStr) {
    for (const edu of education) {
      const degree = (edu.degree || "").toLowerCase();
      if (!MBA_KEYWORDS.some((k) => degree.includes(k))) {
        gradStr = [edu.school, edu.degree].filter(Boolean).join(", ");
        break;
      }
    }
  }

  const careerStats = computeCareerStats(experience);

  return {
    name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
    btech: btechStr,
    graduation: gradStr,
    mba: mbaStr,
    currentOrg: currentRole.company || "",
    currentDesignation: currentRole.position || "",
    totalExperienceYears: careerStats.totalExperienceYears,
    companiesSwitched: careerStats.jobSwitchCount,
    stabilityAvgYears: careerStats.averageTenureYears,
    currentLocation: profileData.location || "",
    graduationYear,
  };
}

// ─── Coerce Utility ──────────────────────────────────────────────

function coerce(v: any): number | string {
  if (v === "" || v == null) return "";
  const n = Number(v);
  return Number.isNaN(n) ? "" : n;
}

// ─── JD Pre-Parser ───────────────────────────────────────────────

function parseJobDescription(jdText: string) {
  if (!jdText) return { raw: "" };
  const parsed: any = { raw: jdText };

  const expMatch =
    jdText.match(/(\d+)\s*[-–to]+\s*(\d+)\s*(?:years?|yrs?)/i) ||
    jdText.match(/(\d+)\+?\s*(?:years?|yrs?)\s*(?:of\s+)?experience/i);
  if (expMatch) {
    parsed.experienceRange = expMatch[2]
      ? `${expMatch[1]}-${expMatch[2]} years`
      : `${expMatch[1]}+ years`;
  }

  const locMatch = jdText.match(/Location\s*[:：]\s*(.+?)(?:\n|$)/i);
  if (locMatch) parsed.location = locMatch[1].trim();

  const eduMatch = jdText.match(/Education\s*[:：]\s*(.+?)(?:\n|$)/i);
  if (eduMatch) parsed.education = eduMatch[1].trim();

  const indMatch = jdText.match(/Industry\s*(?:Type)?\s*[:：]\s*(.+?)(?:\n|$)/i);
  if (indMatch) parsed.industry = indMatch[1].trim();

  const funcMatch = jdText.match(/Functional\s*Area\s*[:：]\s*(.+?)(?:\n|$)/i);
  if (funcMatch) parsed.functionalArea = funcMatch[1].trim();

  const roleMatch = jdText.match(/(?:Role|Designation)\s*[:：]\s*(.+?)(?:\n|$)/i);
  if (roleMatch) parsed.role = roleMatch[1].trim();

  return parsed;
}

// ─── Default Critical Instructions ───────────────────────────────

export const DEFAULT_CRITICAL_INSTRUCTIONS = `CRITICAL INSTRUCTIONS:
1. Your scoring values and scoringLogs MUST be consistent. If your log says an institution is "Tier 1", the score MUST reflect Tier 1 points. If your log says "assign X marks", the score MUST be exactly X. Never contradict yourself — the numeric score must EXACTLY match what your reasoning concludes.
2. Be strict and evidence-based. Do NOT assume, infer, or give benefit of the doubt for missing data. If information is not present, treat it as absent.
3. DISQUALIFIER CHECK: Before scoring, identify any hard requirements in the JD that the candidate clearly FAILS to meet. BE PRECISE — only flag genuine failures:
   - For experience ranges (e.g. "7-15 years"): only flag if candidate is OUTSIDE the range. 8.3 years IS within 7-15, so that is NOT a disqualifier. Only flag if below minimum or above maximum.
   - For mandatory skills: only flag if the skill is explicitly "required"/"mandatory" AND completely absent from the profile.
   - Do NOT flag items that are "preferred" or "nice to have" as disqualifiers.
   List genuine disqualifiers in "flags". If there are none, return an empty array.`;

// ─── Prompt Builders ─────────────────────────────────────────────

/**
 * Assembles the full system prompt from 4 layers:
 *   1. Identity (user-configurable via promptRole)
 *   2. Behavioral rules (built-in + user's guidelines + per-job recruiter context)
 *   3. Scoring rules (auto-generated from enabled dimensions)
 *   4. JSON output schema (internal, never user-facing)
 */
export function buildSystemPrompt(
  scoringRules: ScoringRules,
  customScoringRules: CustomScoringRule[],
  options?: {
    customPrompt?: string;       // Per-job recruiter context (from job creation form)
    promptRole?: string;         // User's evaluator identity (from Settings)
    promptGuidelines?: string;   // User's evaluation guidelines (from Settings)
    criticalInstructions?: string;           // Override default behavioral rules
    builtInRuleDescriptions?: Record<string, string>; // Override per-rule descriptions
  }
): string {
  const opts = options || {};
  const enabled: Record<string, boolean> = {};
  for (const key of Object.keys(LLM_RULE_POINTS)) {
    enabled[key] = (scoringRules as any)[key] !== false;
  }

  const enabledCustomRules = (customScoringRules || []).filter((r) => r.enabled);

  // ── SECTION 1: Identity ──
  const today = new Date().toISOString().split("T")[0];
  const identity = opts.promptRole?.trim()
    ? `${opts.promptRole.trim()} Today's date is ${today}. Do NOT treat recent or current dates as typos — they are valid. Score the candidate using ONLY the rules below. Stability, location, and candidate info are pre-computed — do NOT evaluate them.`
    : `You are a strict ATS evaluator. Today's date is ${today}. Do NOT treat recent or current dates as typos — they are valid. Score the candidate using ONLY the rules below. Stability, location, and candidate info are pre-computed — do NOT evaluate them.`;

  // ── SECTION 2: Behavioral instructions ──
  let behavior = opts.criticalInstructions?.trim() || DEFAULT_CRITICAL_INSTRUCTIONS;

  if (opts.promptGuidelines?.trim()) {
    behavior += `\n\nADDITIONAL EVALUATION GUIDELINES (follow these strictly in all scoring decisions):\n${opts.promptGuidelines.trim()}`;
  }

  if (opts.customPrompt?.trim()) {
    behavior += `\n\nRECRUITER CONTEXT (for this specific job — use to guide ALL scoring decisions below):\n${opts.customPrompt.trim()}`;
  }

  // ── SECTION 3: Scoring rules (auto-generated from config toggles) ──
  const ruleDescriptions = { ...DEFAULT_RULE_PROMPTS, ...(opts.builtInRuleDescriptions || {}) };
  let ruleNum = 0;
  const rulesText = Object.entries(ruleDescriptions)
    .filter(([k]) => enabled[k])
    .map(([, text]) => {
      ruleNum++;
      return `${ruleNum}. ${text}`;
    })
    .join("\n\n");

  const customRulesText = enabledCustomRules
    .map((r) => {
      ruleNum++;
      return `${ruleNum}. ${r.name.toUpperCase()} (Max: ${r.maxPoints})\n   ${r.criteria}`;
    })
    .join("\n\n");

  const allRulesText = [rulesText, customRulesText].filter(Boolean).join("\n\n");

  // ── SECTION 4: JSON output schema (internal — never user-facing) ──
  const scoringSchema: string[] = [];
  if (enabled.growth) {
    scoringSchema.push('    "promotionSameCompany": <15 or "">');
    scoringSchema.push('    "promotionWithChange": <10 or "">');
  }
  if (enabled.graduation) {
    scoringSchema.push('    "gradTier1": <15 or 7 or "">');
    scoringSchema.push('    "gradTier2": <10 or 5 or "">');
  }
  if (enabled.companyType) {
    scoringSchema.push('    "salesCRM": <15 or "">');
    scoringSchema.push('    "otherB2B": <10 or 7 or "">');
  }
  if (enabled.mba) {
    scoringSchema.push('    "mbaA": <15 or "">');
    scoringSchema.push('    "mbaOthers": <10 or "">');
  }
  if (enabled.skillMatch) {
    scoringSchema.push('    "skillsetMatch": <0 or 5 or 10>');
  }
  for (const r of enabledCustomRules) {
    scoringSchema.push(`    "custom_${r.id}": <0 to ${r.maxPoints} integer>`);
  }

  const customLogSchema = enabledCustomRules
    .map(
      (r) =>
        `    "custom_${r.id}": "<1-2 sentence: evidence and reasoning for ${r.name} score>"`
    )
    .join(",\n");

  const jsonBlock = `Respond with ONLY valid JSON (no markdown, no code fences):
{
  "scoring": {
${scoringSchema.join(",\n")}
  },
  "scoringLogs": {
    "growth": "<1-2 sentence: what evidence you found (or didn't), which sub-rule triggered, why this score>",
    "graduation": "<MUST state: 1) degree name, 2) BTech/BE or Non-BTech classification, 3) institution name, 4) Tier 1/Tier 2/Neither, 5) score from lookup table. Example: 'BBA (Non-BTech) from De La Salle University (Tier 2) → gradTier2=5'>",
    "companyType": "<1-2 sentence: company name, why classified as this type, which sub-rule>",
    "mba": "<1-2 sentence: State the MBA/PGDM institution name and tier, OR state 'No MBA/PGDM found in the candidate profile'. NEVER output empty strings or raw score values here — always write a human-readable explanation>",
    "skillMatch": "<1-2 sentence: list which JD-required skills/competencies the candidate has vs lacks, then match %>"${customLogSchema ? ",\n" + customLogSchema : ""}
  },
  "skillBreakdown": {
    "matchedSkills": ["<skill/competency REQUIRED BY THE JD that candidate HAS>", ...],
    "missingSkills": ["<skill/competency REQUIRED BY THE JD that candidate LACKS>", ...],
    "matchPercent": <integer 0-100>
  },
  "remarks": "<concise overall reasoning — reference any disqualifiers found>",
  "experienceSummary": "<2-3 sentence career summary>",
  "strengths": ["<string>", ...],
  "gaps": ["<string>", ...],
  "flags": ["<ONLY genuine disqualifiers — hard JD requirements candidate clearly fails. Empty array [] if none>", ...]
}

Be strict and evidence-based. Do NOT assume missing data. Do NOT give benefit of the doubt.`;

  // ── Stitch all sections ──
  return `${identity}\n\n${behavior}\n\nSCORING RULES (mutually exclusive pairs: fill ONE, leave other as ""):\n\n${allRulesText}\n\n${jsonBlock}`;
}

function buildUserPrompt(profileData: any, jobDescription: string, candidateInfo: CandidateInfo): string {
  const jd = parseJobDescription(jobDescription);

  let prompt = `## Job Description\n`;
  const meta: string[] = [];
  if (jd.role) meta.push(`**Role:** ${jd.role}`);
  if (jd.experienceRange) meta.push(`**Required Experience:** ${jd.experienceRange}`);
  if (jd.location) meta.push(`**Location:** ${jd.location}`);
  if (jd.education) meta.push(`**Education:** ${jd.education}`);
  if (jd.industry) meta.push(`**Industry:** ${jd.industry}`);
  if (jd.functionalArea) meta.push(`**Functional Area:** ${jd.functionalArea}`);

  if (meta.length) {
    prompt += `### Key Requirements (extracted)\n${meta.join("\n")}\n\n`;
    prompt += `### Full JD Text\n${jobDescription}\n\n`;
  } else {
    prompt += `${jobDescription}\n\n`;
  }

  prompt += `## Candidate Profile\n\n`;
  prompt += `**Name:** ${profileData.first_name || ""} ${profileData.last_name || ""}\n`;
  prompt += `**Headline:** ${profileData.headline || "N/A"}\n`;
  prompt += `**Location:** ${profileData.location || "N/A"}\n`;

  const careerStats = computeCareerStats(profileData.work_experience || []);
  prompt += `**Total Experience:** ${careerStats.totalExperienceYears} years | **Companies:** ${careerStats.distinctCompanyCount}\n\n`;

  // About / Summary
  if (profileData.summary) {
    prompt += `### About\n${profileData.summary}\n\n`;
  }

  // Experience (grouped by company to make promotions obvious)
  prompt += `### Experience\n`;
  const experience = profileData.work_experience || [];
  if (experience.length) {
    // Group consecutive roles at the same company
    const groups: { company: string; roles: any[] }[] = [];
    let current: { company: string; roles: any[] } | null = null;
    for (const exp of experience) {
      const company = (exp.company || "Unknown").trim();
      if (current && current.company === company) {
        current.roles.push(exp);
      } else {
        current = { company, roles: [exp] };
        groups.push(current);
      }
    }

    let idx = 1;
    for (const g of groups) {
      if (g.roles.length > 1) {
        prompt += `**${g.company}** (${g.roles.length} roles — check for internal promotion):\n`;
        for (const exp of g.roles) {
          const duration = exp.start
            ? `${exp.start} – ${exp.end || "Present"}`
            : "N/A";
          prompt += `  ${idx}. ${exp.position || "Unknown"} (${duration})\n`;
          if (exp.description) prompt += `     ${exp.description.substring(0, 200)}\n`;
          idx++;
        }
      } else {
        const exp = g.roles[0];
        const duration = exp.start
          ? `${exp.start} – ${exp.end || "Present"}`
          : "N/A";
        prompt += `${idx}. **${exp.position || "Unknown"}** at **${g.company}** (${duration})\n`;
        if (exp.description) prompt += `   ${exp.description.substring(0, 200)}\n`;
        idx++;
      }
    }
    prompt += "\n";
  } else {
    prompt += "Not available — check raw data below.\n\n";
  }

  // Education
  prompt += `### Education\n`;
  const education = profileData.education || [];
  if (education.length) {
    education.forEach((edu: any, i: number) => {
      prompt += `${i + 1}. **${edu.school || "Unknown"}**\n`;
      prompt += `   Degree: ${edu.degree || "N/A"}\n`;
      if (edu.field) prompt += `   Field: ${edu.field}\n`;
      if (edu.start || edu.end) prompt += `   Years: ${edu.start || "?"} – ${edu.end || "Present"}\n`;
      prompt += "\n";
    });
  } else {
    prompt += "Not available — check raw data below.\n\n";
  }

  // Pre-extracted education info
  if (candidateInfo) {
    const eduNotes: string[] = [];
    if (candidateInfo.btech) eduNotes.push(`BTech/BE: ${candidateInfo.btech}`);
    if (candidateInfo.graduation) eduNotes.push(`Graduation: ${candidateInfo.graduation}`);
    if (candidateInfo.mba) eduNotes.push(`MBA: ${candidateInfo.mba}`);
    if (candidateInfo.graduationYear) eduNotes.push(`Graduation Year: ${candidateInfo.graduationYear}`);
    if (eduNotes.length) {
      prompt += `### Pre-extracted Education Details\n${eduNotes.join("\n")}\n\n`;
    }
  }

  // Skills
  prompt += `### Skills\n`;
  const skills = profileData.skills || [];
  if (skills.length) {
    const skillNames = skills.map((s: any) => (typeof s === "string" ? s : s.name)).filter(Boolean);
    prompt += skillNames.join(", ") + "\n\n";
  } else {
    prompt += "Not available — check raw data below.\n\n";
  }

  // Certifications (compact — useful for qualitative)
  const certifications = profileData.certifications || [];
  if (certifications.length) {
    const certNames = certifications
      .map((c: any) => (typeof c === "string" ? c : `${c.name}${c.organization ? ` (${c.organization})` : ""}`))
      .filter(Boolean);
    prompt += `### Certifications\n${certNames.join(", ")}\n\n`;
  }

  return prompt;
}

// ─── Main Analysis Function ──────────────────────────────────────

export async function analyzeProfile(
  profileData: any,
  config: AnalysisConfig
): Promise<AnalysisResult> {
  if (!config.jobDescription) throw new Error("No job description provided for analysis.");

  const rules: ScoringRules = config.scoringRules || {};
  const customRules: CustomScoringRule[] = config.customScoringRules || [];

  // ── Pass 1: Deterministic pre-extraction ──
  const candidateInfo = extractCandidateInfo(profileData);
  const careerStats = computeCareerStats(profileData.work_experience || []);

  const stabilityScore =
    (rules.stability !== false && careerStats) ? careerStats.stabilityScore : "";
  const locationScore =
    rules.location !== false
      ? scoreLocationMatch(profileData.location || "", config.jobDescription)
      : "";

  // Pre-computed scoring logs
  const preComputedLogs: Record<string, string> = {};
  if (rules.stability !== false && careerStats) {
    const avg = careerStats.averageTenureYears;
    preComputedLogs.stability =
      avg > 2.5
        ? `Avg tenure ${avg} yrs (>2.5) across ${careerStats.distinctCompanyCount} companies → 10/10`
        : avg >= 1.5
          ? `Avg tenure ${avg} yrs (1.5–2.5) across ${careerStats.distinctCompanyCount} companies → 7/10`
          : `Avg tenure ${avg} yrs (<1.5) across ${careerStats.distinctCompanyCount} companies → 0/10`;
  }
  if (rules.location !== false) {
    preComputedLogs.location =
      locationScore === 5
        ? `Candidate location "${profileData.location}" matches JD location → 5/5`
        : `Candidate location "${profileData.location || "unknown"}" does not match JD location → 0/5`;
  }

  console.log("[Analyzer] Pre-computed:", { stabilityScore, locationScore, candidateInfo: candidateInfo.name });

  // ── Pass 2: LLM evaluation ──
  const userPrompt = buildUserPrompt(profileData, config.jobDescription, candidateInfo);
  const model = config.aiModel || "gpt-4.1";

  // Build system prompt — user's role/guidelines are stitched in automatically
  const systemPrompt = buildSystemPrompt(rules, customRules, {
    customPrompt: config.customPrompt,
    promptRole: config.promptRole,
    promptGuidelines: config.promptGuidelines,
    criticalInstructions: config.criticalInstructions,
    builtInRuleDescriptions: config.builtInRuleDescriptions,
  });
  console.log(`[Analyzer] System prompt built (${systemPrompt.length} chars), role=${config.promptRole ? 'custom' : 'default'}, guidelines=${config.promptGuidelines ? 'custom' : 'default'}`);

  console.log(`[Analyzer] Calling AI (${model}), prompt: ${userPrompt.length} chars`);

  const aiResult = await chatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model,
    { temperature: 0.1, max_tokens: 2000 },
    config.aiProviderId
  );

  const content = aiResult.content;
  const resultUsage = aiResult.usage;
  console.log(`[Analyzer] AI response (${aiResult.provider}). Usage: ${JSON.stringify(resultUsage)}`);

  let llmResult: any;
  try {
    const cleaned = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/i, "").trim();
    llmResult = JSON.parse(cleaned);
  } catch {
    console.error("[Analyzer] Failed to parse AI response:", content);
    throw new Error("AI returned invalid JSON. Please retry.");
  }

  // ── Pass 3: Merge deterministic + LLM ──
  const llmScoring = llmResult.scoring || {};

  function ruleVal(ruleKey: string, field: string): number | string {
    if ((rules as any)[ruleKey] === false) return "";
    return coerce(llmScoring[field]);
  }

  const scoring: Record<string, number | string> = {
    stability: stabilityScore,
    promotionSameCompany: ruleVal("growth", "promotionSameCompany"),
    promotionWithChange: ruleVal("growth", "promotionWithChange"),
    gradTier1: ruleVal("graduation", "gradTier1"),
    gradTier2: ruleVal("graduation", "gradTier2"),
    salesCRM: ruleVal("companyType", "salesCRM"),
    otherB2B: ruleVal("companyType", "otherB2B"),
    mbaA: ruleVal("mba", "mbaA"),
    mbaOthers: ruleVal("mba", "mbaOthers"),
    skillsetMatch: ruleVal("skillMatch", "skillsetMatch"),
    locationMatch: locationScore,
  };

  // Merge custom rule scores
  const enabledCustomRules = customRules.filter((r) => r.enabled);
  for (const r of enabledCustomRules) {
    const val = coerce(llmScoring[`custom_${r.id}`]);
    scoring[`custom_${r.id}`] =
      typeof val === "number" ? Math.min(val, r.maxPoints) : 0;
  }

  // Compute total
  const totalScore = Object.values(scoring).reduce<number>(
    (sum, v) => sum + (typeof v === "number" ? v : 0),
    0
  );

  let maxScore = Object.entries(RULE_POINTS)
    .filter(([k]) => (rules as any)[k] !== false)
    .reduce((sum, [, v]) => sum + v, 0);
  for (const r of enabledCustomRules) maxScore += r.maxPoints;

  const scorePercent =
    maxScore > 0 ? Math.round((totalScore / maxScore) * 1000) / 10 : 0;
  const recommendation =
    scorePercent >= 70
      ? "Strong Fit"
      : scorePercent >= 40
        ? "Moderate Fit"
        : "Not a Fit";

  // Merge scoring logs
  const llmLogs = llmResult.scoringLogs || {};
  const scoringLogs = { ...preComputedLogs, ...llmLogs };

  const merged: AnalysisResult = {
    candidateInfo,
    scoring,
    scoringLogs,
    maxScore,
    totalScore,
    scorePercent,
    recommendation,
    customScoringRules: enabledCustomRules,
    remarks: llmResult.remarks || "",
    experienceSummary: llmResult.experienceSummary || "",
    skillBreakdown: llmResult.skillBreakdown || null,
    strengths: llmResult.strengths || [],
    gaps: llmResult.gaps || [],
    flags: llmResult.flags || [],
    __debug: {
      systemPrompt,
      userPrompt,
      model,
      usage: resultUsage,
      preComputed: { stability: stabilityScore, location: locationScore },
    },
  };

  console.log(
    `[Analyzer] Score: ${totalScore}/${maxScore} (${scorePercent}%) → ${recommendation}`
  );

  return merged;
}

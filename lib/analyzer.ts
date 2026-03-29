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

const RULE_PROMPTS: Record<string, string> = {
  growth: `GROWTH (Max: 15) — MUTUALLY EXCLUSIVE. Full-time roles only (ignore internships/trainee/part-time).
   Seniority ladder (low→high): Executive/Associate → Senior Executive/Specialist → Lead/Team Lead → Manager → Senior Manager → Director/AVP → VP/Head → CXO/Partner
   - Internal promotion (up ≥1 level, SAME company) → promotionSameCompany=15, promotionWithChange=""
   - External growth only (higher level at NEW company, no internal promotion) → promotionSameCompany="", promotionWithChange=10
   - Both internal + external → promotionSameCompany=15, promotionWithChange=""
   - Neither (lateral moves, no upward movement, or insufficient data) → both ""
   Note: title variation without level change is NOT a promotion.`,

  graduation: `GRADUATION (Max: 15) — MUTUALLY EXCLUSIVE — UNDERGRADUATE degree only (NOT MBA — scored separately).
   Step 1 — Degree type: "BTech/BE" = BTech, B.Tech, BE, B.E., BS/BSc in CS or Engineering only. Everything else (BCA, BBA, BCom, BA, BSc non-CS, BMS, etc.) = "Non-BTech".
   Step 2 — Institution tier: Tier 1 = premier national/global. Tier 2 = well-known reputable. Neither = all others.
   Score table:
   | Degree    | Tier 1 | Tier 2 | Neither |
   |-----------|--------|--------|---------|
   | BTech/BE  | gradTier1=15 | gradTier2=10 | both "" |
   | Non-BTech | gradTier1=7  | gradTier2=5  | both "" |`,

  companyType: `COMPANY TYPE (Max: 15) — MUTUALLY EXCLUSIVE, based on CURRENT/most recent company.
   - Product B2B CRM/SalesTech → salesCRM=15, otherB2B=""
   - Product B2B SaaS non-CRM (cloud, infra, dev tools, data, HR tech, fintech, AI/ML, cybersecurity) → salesCRM="", otherB2B=10
   - Service-based/IT consulting → salesCRM="", otherB2B=7
   - Product B2C or unrelated → both ""
   If evidence strongly implies B2B SaaS, classify accordingly — do NOT default to 0.`,

  mba: `MBA (Max: 15) — MUTUALLY EXCLUSIVE
   - MBA/PGDM from Tier 1 (premier national/global business school) → mbaA=15, mbaOthers=""
   - MBA/PGDM from other institution → mbaA="", mbaOthers=10
   - No MBA/PGDM → both ""`,

  skillMatch: `SKILLSET MATCH (Max: 10) — Extract KEY SKILLS required by JD, then check which the candidate has (from experience, skills, certifications). Compare against JD requirements, not just candidate's listed skills.
   - >70% JD-required skills matched → 10
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

function extractCandidateInfo(profileData: any, careerStats: CareerStats): CandidateInfo {
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

// ─── Prompt Builders ─────────────────────────────────────────────

function buildSystemPrompt(
  scoringRules: ScoringRules,
  customScoringRules: CustomScoringRule[],
  customPrompt?: string
): string {
  const enabled: Record<string, boolean> = {};
  for (const key of Object.keys(LLM_RULE_POINTS)) {
    enabled[key] = (scoringRules as any)[key] !== false;
  }

  const enabledCustomRules = (customScoringRules || []).filter((r) => r.enabled);

  let ruleNum = 0;
  const rulesText = Object.entries(RULE_PROMPTS)
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

  // Build scoring JSON schema
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

  let prompt = `You are a strict ATS evaluator. Today's date is ${new Date().toISOString().split("T")[0]}. Do NOT treat recent or current dates as typos — they are valid. Score the candidate using ONLY the rules below. Stability, location, and candidate info are pre-computed — do NOT evaluate them.

CRITICAL INSTRUCTIONS:
1. Your scoring values and scoringLogs MUST be consistent. If your log says an institution is "Tier 1", the score MUST reflect Tier 1 points. If your log says "assign X marks", the score MUST be exactly X. Never contradict yourself — the numeric score must EXACTLY match what your reasoning concludes.
2. Be strict and evidence-based. Do NOT assume, infer, or give benefit of the doubt for missing data. If information is not present, treat it as absent.
3. DISQUALIFIER CHECK: Before scoring, identify any hard requirements in the JD that the candidate clearly FAILS to meet. BE PRECISE — only flag genuine failures:
   - For experience ranges (e.g. "7-15 years"): only flag if candidate is OUTSIDE the range. 8.3 years IS within 7-15, so that is NOT a disqualifier. Only flag if below minimum or above maximum.
   - For mandatory skills: only flag if the skill is explicitly "required"/"mandatory" AND completely absent from the profile.
   - Do NOT flag items that are "preferred" or "nice to have" as disqualifiers.
   List genuine disqualifiers in "flags". If there are none, return an empty array.`;

  if (customPrompt) {
    prompt += `\n\nRECRUITER CONTEXT (use this to guide ALL scoring decisions below):\n${customPrompt}`;
  }

  prompt += `\n\nSCORING RULES (mutually exclusive pairs: fill ONE, leave other as ""):

${allRulesText}

Respond with ONLY valid JSON (no markdown, no code fences):
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

  return prompt;
}

function buildUserPrompt(profileData: any, jobDescription: string, candidateInfo: CandidateInfo, careerStats: CareerStats): string {
  let prompt = `JOB DESCRIPTION:\n${jobDescription}\n\nCANDIDATE PROFILE:\n`;

  const profile: any = {
    name: `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
    headline: profileData.headline || "",
    location: profileData.location || "",
    totalExperience: `${careerStats.totalExperienceYears} years`,
    companies: careerStats.distinctCompanyCount,
  };

  if (profileData.summary) {
    profile.summary = profileData.summary;
  }

  // Experience: only fields the LLM needs for scoring
  const experience = (profileData.work_experience || []).map((exp: any) => {
    const entry: any = {
      company: exp.company || "Unknown",
      position: exp.position || "Unknown",
      start: exp.start || null,
      end: exp.end || null,
    };
    if (exp.description) entry.description = exp.description.substring(0, 150);
    return entry;
  });
  if (experience.length) profile.experience = experience;

  // Education: only school, degree, dates
  const education = (profileData.education || []).map((edu: any) => {
    const entry: any = {
      school: edu.school || "Unknown",
      degree: edu.degree || "N/A",
    };
    if (edu.field) entry.field = edu.field;
    if (edu.start) entry.start = edu.start;
    if (edu.end) entry.end = edu.end;
    return entry;
  });
  if (education.length) profile.education = education;

  // Pre-extracted education details
  if (candidateInfo.btech) profile.btech = candidateInfo.btech;
  if (candidateInfo.graduation) profile.gradDegree = candidateInfo.graduation;
  if (candidateInfo.mba) profile.mba = candidateInfo.mba;
  if (candidateInfo.graduationYear) profile.graduationYear = candidateInfo.graduationYear;

  // Skills: just names
  const skills = (profileData.skills || [])
    .map((s: any) => (typeof s === "string" ? s : s.name))
    .filter(Boolean);
  if (skills.length) profile.skills = skills;

  // Certifications: just name + org
  const certs = (profileData.certifications || [])
    .map((c: any) => (typeof c === "string" ? c : `${c.name}${c.organization ? ` (${c.organization})` : ""}`))
    .filter(Boolean);
  if (certs.length) profile.certifications = certs;

  prompt += JSON.stringify(profile, null, 1);
  return prompt;
}

// ─── Main Analysis Function ──────────────────────────────────────

export async function analyzeProfile(
  profileData: any,
  config: AnalysisConfig
): Promise<AnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set in environment variables.");
  if (!config.jobDescription) throw new Error("No job description provided for analysis.");

  const rules: ScoringRules = config.scoringRules || {};
  const customRules: CustomScoringRule[] = config.customScoringRules || [];

  // ── Pass 1: Deterministic pre-extraction ──
  const careerStats = computeCareerStats(profileData.work_experience || []);
  const candidateInfo = extractCandidateInfo(profileData, careerStats);

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
  const systemPrompt = buildSystemPrompt(rules, customRules, config.customPrompt);
  const userPrompt = buildUserPrompt(profileData, config.jobDescription, candidateInfo, careerStats);
  const model = config.aiModel || "gpt-4.1";

  console.log(`[Analyzer] Calling OpenAI (${model}), prompt: ${userPrompt.length} chars`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errData: any = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("Invalid OpenAI API key.");
    if (response.status === 429) throw new Error("OpenAI rate limit exceeded. Wait and retry.");
    if (response.status === 402) throw new Error("Insufficient OpenAI credits.");
    throw new Error(errData.error?.message || `OpenAI API error (${response.status})`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;
  console.log(`[Analyzer] OpenAI response. Usage: ${JSON.stringify(result.usage)}`);

  if (!content) throw new Error("No response from OpenAI.");

  let llmResult: any;
  try {
    llmResult = JSON.parse(content);
  } catch {
    // Fallback: try cleaning markdown fences in case response_format was ignored
    try {
      const cleaned = content.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/i, "").trim();
      llmResult = JSON.parse(cleaned);
    } catch {
      console.error("[Analyzer] Failed to parse AI response:", content);
      throw new Error("AI returned invalid JSON. Please retry.");
    }
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
      usage: result.usage,
      preComputed: { stability: stabilityScore, location: locationScore },
    },
  };

  console.log(
    `[Analyzer] Score: ${totalScore}/${maxScore} (${scorePercent}%) → ${recommendation}`
  );

  return merged;
}

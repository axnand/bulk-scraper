export interface ExtractedWorkExperience {
  company: string;
  position: string;
  start: string; // "M/D/YYYY" — compatible with analyzer's parseMonthYear
  end: string | null; // null means "Present"
}

export interface ExtractedResumeInfo {
  name: string;
  linkedinUrl: string;
  currentOrg: string;
  currentDesignation: string;
  currentLocation: string;
  workExperience: ExtractedWorkExperience[];
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonth(s: string): number | null {
  return MONTHS[s.toLowerCase()] ?? null;
}

// "March 2026 - Present (2 months)" | "August 2020 - March 2022 (1 year 8 months)"
const DATE_LINE_RE =
  /^([A-Za-z]+)\s+(\d{4})\s*[-–—]\s*(Present|([A-Za-z]+)\s+(\d{4}))(?:\s*\(.+\))?\s*$/;

// Positions that must NOT count toward tenure / stability — they're not full-time employment.
// Whole-word match against the position string (case-insensitive).
const NON_FULL_TIME_POSITION_RE =
  /\b(intern|internship|trainee|apprentice|volunteer|freelance|freelancer|contractor|part[-\s]?time|summer\s+associate|intern\.)\b/i;

function isFullTimeRole(position: string): boolean {
  if (!position) return false;
  return !NON_FULL_TIME_POSITION_RE.test(position);
}

function extractWorkExperience(lines: string[]): ExtractedWorkExperience[] {
  // Locate the "Experience" section
  let expStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() === "experience") {
      expStart = i + 1;
      break;
    }
  }
  if (expStart === -1) return [];

  const entries: ExtractedWorkExperience[] = [];

  for (let i = expStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Stop at the next section (Education, Activity, etc.)
    const lower = line.toLowerCase();
    if (SECTION_HEADERS.has(lower) && lower !== "experience") break;

    const m = DATE_LINE_RE.exec(line);
    if (!m) continue;

    // Position is the closest non-empty line above; company the one above that.
    let posIdx = i - 1;
    while (posIdx >= 0 && !lines[posIdx]) posIdx--;
    if (posIdx < 0) continue;
    const position = lines[posIdx];

    let compIdx = posIdx - 1;
    while (compIdx >= 0 && !lines[compIdx]) compIdx--;
    if (compIdx < 0) continue;
    const company = lines[compIdx];

    // Guard against misreads (company shouldn't be a section header or another date line)
    if (SECTION_HEADERS.has(company.toLowerCase())) continue;
    if (DATE_LINE_RE.test(company)) continue;
    if (DATE_LINE_RE.test(position)) continue;

    // Skip non-full-time roles — stability/tenure should only reflect real employment.
    if (!isFullTimeRole(position)) continue;

    const startMonth = parseMonth(m[1]);
    const startYear = parseInt(m[2], 10);
    if (!startMonth || !startYear) continue;

    let end: string | null = null;
    if (m[3].toLowerCase() !== "present") {
      const endMonth = parseMonth(m[4]);
      const endYear = parseInt(m[5], 10);
      if (!endMonth || !endYear) continue;
      end = `${endMonth}/1/${endYear}`;
    }

    entries.push({
      company,
      position,
      start: `${startMonth}/1/${startYear}`,
      end,
    });
  }

  return entries;
}

const SECTION_HEADERS = new Set([
  "contact",
  "top skills",
  "skills",
  "summary",
  "experience",
  "education",
  "activity",
  "languages",
  "certifications",
  "publications",
  "projects",
  "honors-awards",
  "honors & awards",
  "volunteer experience",
  "interests",
  "recommendations",
]);

function isContactMetaLine(s: string): boolean {
  if (/\((?:email|phone|mobile|other|fax|telephone|personal)\)/i.test(s)) return true;
  if (/^[\w.+-]+@[\w.-]+\.\w{2,}$/i.test(s)) return true;
  return false;
}

function isSectionHeader(s: string): boolean {
  return SECTION_HEADERS.has(s.toLowerCase().trim());
}

const LINKEDIN_URL_PATTERN = /linkedin\.com\/in\/([\w%-]+(?:\r?\n[\w%-]+)*)/i;
const HEADLINE_PATTERN = /^(.+?)\s+@\s+(.+)$/;

// LinkedIn URL may wrap across lines, e.g. "www.linkedin.com/in/naman-\nsuyal-441416258"
function extractLinkedInUrl(text: string): string {
  const m = LINKEDIN_URL_PATTERN.exec(text);
  if (!m) return "";
  const handle = m[1].replaceAll(/\s+/g, "");
  return `https://www.linkedin.com/in/${handle}`;
}

// Strongest anchor in LinkedIn PDFs: a line of the form "Designation @ Company".
function findHeadline(
  lines: string[]
): { idx: number; designation: string; org: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /linkedin\.com/i.test(line)) continue;
    const m = HEADLINE_PATTERN.exec(line);
    if (m) return { idx: i, designation: m[1].trim(), org: m[2].trim() };
  }
  return null;
}

// Name: first qualifying non-empty line before the headline. Stops at section headers / URL lines.
function findNameBeforeHeadline(lines: string[], headlineIdx: number): string {
  for (let i = headlineIdx - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    if (isSectionHeader(line) || /linkedin\.com/i.test(line)) break;
    if (isContactMetaLine(line)) continue;
    return line;
  }
  return "";
}

// Location: first non-empty line after the headline (before the next section header).
function findLocationAfterHeadline(lines: string[], headlineIdx: number): string {
  for (let i = headlineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (isSectionHeader(line)) return "";
    return line;
  }
  return "";
}

export function extractResumeInfo(text: string): ExtractedResumeInfo {
  const result: ExtractedResumeInfo = {
    name: "",
    linkedinUrl: "",
    currentOrg: "",
    currentDesignation: "",
    currentLocation: "",
    workExperience: [],
  };

  if (!text) return result;

  result.linkedinUrl = extractLinkedInUrl(text);

  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const headline = findHeadline(lines);
  if (headline) {
    result.currentDesignation = headline.designation;
    result.currentOrg = headline.org;
    result.name = findNameBeforeHeadline(lines, headline.idx);
    result.currentLocation = findLocationAfterHeadline(lines, headline.idx);
  }

  result.workExperience = extractWorkExperience(lines);

  return result;
}

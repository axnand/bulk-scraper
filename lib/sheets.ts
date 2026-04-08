/**
 * Google Sheets Export — Matches linkedInScraper Chrome Extension format
 *
 * Appends a candidate row to a Google Sheet via a Google Apps Script Web App.
 * Sends { jdTitle, columns, rowData } where columns are {key, label, group?}
 * objects so the script can create per-JD tabs with grouped headers.
 */

export interface SheetColumn {
  key: string;
  label: string;
  group?: string;
}

export interface SheetExportPayload {
  jdTitle: string;
  columns: SheetColumn[];
  rowData: Record<string, any>;
}

export interface ScoringRulesConfig {
  stability?: boolean;
  growth?: boolean;
  graduation?: boolean;
  companyType?: boolean;
  mba?: boolean;
  skillMatch?: boolean;
  location?: boolean;
}

export async function exportToSheet(
  webAppUrl: string,
  payload: SheetExportPayload
): Promise<{ success: boolean; duplicate?: boolean; error?: string }> {
  if (!webAppUrl) {
    return { success: false, error: "No Google Sheet web app URL configured." };
  }

  try {
    const response = await fetch(webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
      redirect: "follow",
    });

    if (!response.ok) {
      return { success: false, error: `Sheet API error (${response.status})` };
    }

    const text = await response.text();
    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      console.error("[Sheets] Non-JSON response:", text.substring(0, 200));
      return {
        success: false,
        error: "Google returned HTML instead of JSON. Check your Apps Script deployment.",
      };
    }

    if (result.status === "ok") {
      console.log("[Sheets] Row appended successfully");
      return { success: true, duplicate: result.duplicate || false };
    }

    return { success: false, error: result.error || "Unexpected response from Apps Script" };
  } catch (err: any) {
    console.error("[Sheets] Failed to append row:", err.message);
    return { success: false, error: err.message };
  }
}

// Helper: preserve 0 as 0, but convert "" / null / undefined to ""
function sv(v: any): any {
  return v !== "" && v != null ? v : "";
}

/**
 * Build a standard row payload from an analysis result for sheet export.
 * Matches the LinkedIn scraper's dynamic column schema format exactly.
 * Only includes columns for enabled scoring rules.
 */
export function buildSheetPayload(
  candidateUrl: string,
  analysisResult: any,
  jdTitle: string,
  scoringRules?: ScoringRulesConfig
): SheetExportPayload {
  const info = analysisResult.candidateInfo || {};
  const sc = analysisResult.scoring || {};
  const rules = scoringRules || {};
  const customRules = analysisResult.customScoringRules || [];

  // ── Build dynamic columns schema (only enabled rules get columns) ──
  const columns: SheetColumn[] = [
    { key: "date", label: "Date" },
    { key: "name", label: "Name" },
    { key: "linkedinProfile", label: "LinkedIn Profile" },
    { key: "btech", label: "BTech" },
    { key: "mba", label: "MBA" },
    { key: "currentOrg", label: "Current Org" },
    { key: "totalExperienceYears", label: "Total Experience (In Yrs)" },
    { key: "companiesSwitched", label: "Number of Companies Switched" },
    { key: "currentLocation", label: "Current Location" },
  ];

  // Scoring columns — only for enabled rules
  if (rules.stability !== false) {
    columns.push({ key: "stability", label: "Stability (10)" });
  }
  if (rules.location !== false) {
    columns.push({ key: "locationMatch", label: "Location (5)" });
  }
  if (rules.growth !== false) {
    columns.push(
      { key: "promotionSameCompany", label: "Same Company (15)", group: "Growth" },
      { key: "promotionWithChange", label: "With Change (10)", group: "Growth" },
    );
  }
  if (rules.graduation !== false) {
    columns.push(
      { key: "gradTier1", label: "Tier 1 (15)", group: "Graduation" },
      { key: "gradTier2", label: "Tier 2 (10)", group: "Graduation" },
    );
  }
  if (rules.companyType !== false) {
    columns.push(
      { key: "salesCRM", label: "Sales/CRM (15)", group: "Company Type" },
      { key: "otherB2B", label: "Other B2B (10)", group: "Company Type" },
    );
  }
  if (rules.mba !== false) {
    columns.push(
      { key: "mbaA", label: "MBA A (15)", group: "MBA" },
      { key: "mbaOthers", label: "MBA Others (10)", group: "MBA" },
    );
  }
  if (rules.skillMatch !== false) {
    columns.push({ key: "skillsetMatch", label: "Skill Match (10)" });
  }

  // Custom scoring rules (dynamic)
  for (const r of customRules) {
    columns.push({ key: `custom_${r.id}`, label: `${r.name} (${r.maxPoints})` });
  }

  // Manual entry + summary columns (always present)
  columns.push(
    { key: "currentCTC", label: "Current CTC" },
    { key: "joiningCTCCurrentOrg", label: "Joining CTC in Current Org" },
    { key: "expectedCTC", label: "Expected CTC" },
    { key: "offerInHand", label: "Offer in Hand (if any)" },
    { key: "remarks", label: "Remarks" },
    { key: "totalScore", label: "Score" },
    { key: "scorePercent", label: "Score %" },
    { key: "source", label: "Source" },
  );

  // ── Build row data (all keys — Apps Script maps by column key) ──
  const rowData: Record<string, any> = {
    date: new Date().toLocaleDateString(),
    name: info.name || "",
    linkedinProfile: candidateUrl,
    btech: info.btech || "",
    mba: info.mba || "",
    currentOrg: info.currentOrg || "",
    totalExperienceYears: sv(info.totalExperienceYears),
    companiesSwitched: sv(info.companiesSwitched),
    currentLocation: info.currentLocation || "",
    stability: sv(sc.stability),
    locationMatch: sv(sc.locationMatch),
    promotionSameCompany: sv(sc.promotionSameCompany),
    promotionWithChange: sv(sc.promotionWithChange),
    gradTier1: sv(sc.gradTier1),
    gradTier2: sv(sc.gradTier2),
    salesCRM: sv(sc.salesCRM),
    otherB2B: sv(sc.otherB2B),
    mbaA: sv(sc.mbaA),
    mbaOthers: sv(sc.mbaOthers),
    skillsetMatch: sv(sc.skillsetMatch),
    currentCTC: "",
    joiningCTCCurrentOrg: "",
    expectedCTC: "",
    offerInHand: "",
    remarks: analysisResult.remarks || "",
    totalScore:
      analysisResult.totalScore != null && analysisResult.maxScore != null
        ? `${analysisResult.totalScore}/${analysisResult.maxScore}`
        : sv(analysisResult.totalScore),
    scorePercent: sv(analysisResult.scorePercent),
    source: "Bulk Scraper",
  };

  // Add custom rule scores
  for (const r of customRules) {
    rowData[`custom_${r.id}`] = sv(sc[`custom_${r.id}`]);
  }

  return { jdTitle, columns, rowData };
}

/**
 * Build columns + rows for a batch of tasks (for bulk export).
 * Returns the column schema once + an array of row data objects.
 * Reuses buildSheetPayload so the format is always identical.
 */
export function buildBulkExportData(
  tasks: { url: string; analysisResult: any }[],
  jdTitle: string,
  scoringRules?: ScoringRulesConfig
): { columns: SheetColumn[]; rows: Record<string, any>[] } {
  let columns: SheetColumn[] = [];
  const rows: Record<string, any>[] = [];

  for (const task of tasks) {
    const payload = buildSheetPayload(task.url, task.analysisResult, jdTitle, scoringRules);
    if (columns.length === 0) columns = payload.columns;
    rows.push(payload.rowData);
  }

  return { columns, rows };
}

/**
 * Google Sheets Export — Ported from linkedInScraper Chrome Extension
 *
 * Appends a candidate row to a Google Sheet via a Google Apps Script Web App.
 * Sends { jdTitle, columns, rowData } so the script can create per-JD tabs.
 */

export interface SheetExportPayload {
  jdTitle: string;
  columns: string[];
  rowData: Record<string, any>;
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
      console.log("[Sheets] ✅ Row appended successfully");
      return { success: true, duplicate: result.duplicate || false };
    }

    return { success: false, error: result.error || "Unexpected response from Apps Script" };
  } catch (err: any) {
    console.error("[Sheets] Failed to append row:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Build a standard row payload from an analysis result for sheet export.
 */
export function buildSheetPayload(
  candidateUrl: string,
  analysisResult: any,
  jdTitle: string
): SheetExportPayload {
  const info = analysisResult.candidateInfo || {};
  const scoring = analysisResult.scoring || {};

  const columns = [
    "Name", "LinkedIn URL", "Current Org", "Current Designation",
    "Total Experience (yrs)", "Companies Switched", "Avg Tenure (yrs)",
    "Location", "BTech/BE", "Graduation", "MBA", "Graduation Year",
    "Stability", "Growth (Same Co)", "Growth (Change)",
    "Grad Tier 1", "Grad Tier 2", "Sales/CRM", "Other B2B",
    "MBA A", "MBA Others", "Skillset Match", "Location Match",
    "Total Score", "Max Score", "Score %", "Recommendation",
    "Strengths", "Gaps", "Flags", "Remarks",
  ];

  // Add custom rule columns
  const customRules = analysisResult.customScoringRules || [];
  for (const r of customRules) {
    columns.push(r.name);
  }

  const rowData: Record<string, any> = {
    "Name": info.name || "",
    "LinkedIn URL": candidateUrl,
    "Current Org": info.currentOrg || "",
    "Current Designation": info.currentDesignation || "",
    "Total Experience (yrs)": info.totalExperienceYears || 0,
    "Companies Switched": info.companiesSwitched || 0,
    "Avg Tenure (yrs)": info.stabilityAvgYears || 0,
    "Location": info.currentLocation || "",
    "BTech/BE": info.btech || "",
    "Graduation": info.graduation || "",
    "MBA": info.mba || "",
    "Graduation Year": info.graduationYear || "",
    "Stability": scoring.stability ?? "",
    "Growth (Same Co)": scoring.promotionSameCompany ?? "",
    "Growth (Change)": scoring.promotionWithChange ?? "",
    "Grad Tier 1": scoring.gradTier1 ?? "",
    "Grad Tier 2": scoring.gradTier2 ?? "",
    "Sales/CRM": scoring.salesCRM ?? "",
    "Other B2B": scoring.otherB2B ?? "",
    "MBA A": scoring.mbaA ?? "",
    "MBA Others": scoring.mbaOthers ?? "",
    "Skillset Match": scoring.skillsetMatch ?? "",
    "Location Match": scoring.locationMatch ?? "",
    "Total Score": analysisResult.totalScore ?? 0,
    "Max Score": analysisResult.maxScore ?? 0,
    "Score %": analysisResult.scorePercent ?? 0,
    "Recommendation": analysisResult.recommendation || "",
    "Strengths": (analysisResult.strengths || []).join("; "),
    "Gaps": (analysisResult.gaps || []).join("; "),
    "Flags": (analysisResult.flags || []).join("; "),
    "Remarks": analysisResult.remarks || "",
  };

  for (const r of customRules) {
    rowData[r.name] = scoring[`custom_${r.id}`] ?? "";
  }

  return { jdTitle, columns, rowData };
}

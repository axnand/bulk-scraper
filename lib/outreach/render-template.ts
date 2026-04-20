export interface TemplateVars {
  name: string;
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  score: string;
}

export function buildVars(profile: any, analysis: any): TemplateVars {
  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    analysis?.candidateInfo?.name ||
    profile?.extractedInfo?.name ||
    "there";

  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? "there";
  const lastName = parts.slice(1).join(" ");

  const company =
    analysis?.candidateInfo?.currentOrg ||
    profile?.extractedInfo?.currentOrg ||
    "";

  const role =
    analysis?.candidateInfo?.currentDesignation ||
    profile?.extractedInfo?.currentDesignation ||
    profile?.headline ||
    "";

  const score =
    analysis?.scorePercent != null ? `${Math.round(analysis.scorePercent)}%` : "";

  return { name: fullName, firstName, lastName, company, role, score };
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{name\}\}/gi, vars.name)
    .replace(/\{\{firstName\}\}/gi, vars.firstName)
    .replace(/\{\{lastName\}\}/gi, vars.lastName)
    .replace(/\{\{company\}\}/gi, vars.company)
    .replace(/\{\{role\}\}/gi, vars.role)
    .replace(/\{\{score\}\}/gi, vars.score);
}

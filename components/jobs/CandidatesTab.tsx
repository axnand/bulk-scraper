"use client";

import { useState, useEffect } from "react";
import { estimateCost, formatCost } from "@/lib/model-pricing";
import { getEffectiveRules } from "@/lib/analyzer";

interface TaskResult {
  id: string;
  url: string;
  status: string;
  result: any;
  analysisResult: any;
  errorMessage: string | null;
  retryCount: number;
  runId?: string;
  runIndex?: number;
  addedAt?: string;
}

interface JobResults {
  id: string;
  title: string;
  department: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  config?: any;
  tasks: TaskResult[];
}

interface SheetIntegrationType {
  id: string;
  name: string;
  url: string;
}

interface Props {
  data: JobResults;
  requisitionId: string;
  onRefresh: () => void;
}

export function CandidatesTab({ data, requisitionId, onRefresh }: Props) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [sheetUrl, setSheetUrl] = useState(data.config?.sheetWebAppUrl || "");
  const [sheetIntegrations, setSheetIntegrations] = useState<SheetIntegrationType[]>([]);

  useEffect(() => {
    fetch("/api/sheet-integrations")
      .then(r => r.ok ? r.json() : [])
      .then(setSheetIntegrations)
      .catch(() => {});
  }, []);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setExportMsg(null);
  }

  async function runExport(mode: "xlsx" | "sheet") {
    setExportLoading(true);
    setExportMsg(null);
    try {
      const body: any = {};
      if (selectedIds.size > 0) body.taskIds = Array.from(selectedIds);
      if (mode === "sheet") body.sheetWebAppUrl = sheetUrl.trim();

      const res = await fetch(`/api/requisitions/${requisitionId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (mode === "sheet") {
        const json = await res.json();
        if (!res.ok) { setExportMsg({ type: "error", text: json.error || "Export failed" }); return; }
        setExportMsg({ type: "success", text: `Exported ${json.exported}/${json.total} profiles to "${json.tabName}"${json.failed ? ` (${json.failed} failed)` : ""}` });
        setShowSheetModal(false);
      } else {
        if (!res.ok) { const json = await res.json(); setExportMsg({ type: "error", text: json.error || "Export failed" }); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "export.xlsx";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setExportMsg({ type: "success", text: "XLSX downloaded" });
      }
    } catch (err: any) {
      setExportMsg({ type: "error", text: err.message });
    } finally {
      setExportLoading(false);
    }
  }

  const completedTasks = data.tasks.filter(t => t.status === "DONE");
  const analysedTasks = completedTasks.filter(t => t.analysisResult);
  const allAnalysedIds = analysedTasks.map(t => t.id);
  const allSelected = allAnalysedIds.length > 0 && selectedIds.size === allAnalysedIds.length;

  return (
    <div className={`space-y-6 ${selectMode ? "pb-28" : ""}`}>
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total" value={data.totalTasks} color="text-foreground" />
        <StatCard label="Success" value={data.successCount} color="text-emerald-400" />
        <StatCard label="Failed" value={data.failedCount} color="text-rose-400" />
      </div>

      {/* Completed Profiles */}
      {completedTasks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-foreground shrink-0">
              Scraped Profiles ({completedTasks.length})
            </h2>
            {analysedTasks.length > 0 && !selectMode && (
              <button
                onClick={() => setSelectMode(true)}
                className="ml-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
              >
                Select to export
              </button>
            )}
            {selectMode && (
              <button
                onClick={() => setSelectedIds(allSelected ? new Set() : new Set(allAnalysedIds))}
                className="ml-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-muted text-muted-foreground hover:bg-accent transition-colors"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
            <div className="flex-1" />
            {completedTasks.length > 1 && (
              <input
                type="text"
                placeholder="Search by name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary w-full max-w-xs"
              />
            )}
          </div>

          <div className="space-y-3">
            {completedTasks
              .filter(task => {
                if (!search.trim()) return true;
                const profile = task.result;
                if (!profile) return false;
                const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.toLowerCase();
                return fullName.includes(search.toLowerCase().trim());
              })
              .map(task => {
                const isSelected = selectedIds.has(task.id);
                const isSelectable = selectMode && !!task.analysisResult;
                return (
                  <div
                    key={task.id}
                    onClick={isSelectable ? () => toggleSelect(task.id) : undefined}
                    className={`relative rounded-xl transition-all ${isSelectable ? "cursor-pointer" : ""} ${
                      isSelected
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : isSelectable
                        ? "ring-1 ring-border hover:ring-primary/50"
                        : ""
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3 z-10 h-6 w-6 rounded-full bg-primary flex items-center justify-center shadow-lg">
                        <svg className="w-3.5 h-3.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {isSelectable && !isSelected && (
                      <div className="absolute top-3 right-3 z-10 h-6 w-6 rounded-full border-2 border-border bg-background/80" />
                    )}
                    <ProfileCard
                      task={task}
                      jobConfig={data.config}
                      expanded={!selectMode && expandedTask === task.id}
                      onToggle={() => {
                        if (selectMode) return;
                        setExpandedTask(expandedTask === task.id ? null : task.id);
                      }}
                    />
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Floating Export Bar */}
      {selectMode && (
        <div className="fixed bottom-0 left-56 right-0 z-40 flex justify-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-3">
            <div className="shrink-0 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-7 px-2.5 rounded-full bg-primary text-primary-foreground text-xs font-bold min-w-[28px]">
                {selectedIds.size}
              </span>
              <span className="text-sm text-foreground">
                {selectedIds.size === 0 ? "None selected" : `profile${selectedIds.size !== 1 ? "s" : ""} selected`}
              </span>
            </div>
            <div className="flex-1" />
            {exportMsg && (
              <span className={`text-xs px-2 py-1 rounded-lg ${exportMsg.type === "success" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                {exportMsg.text}
              </span>
            )}
            <button
              onClick={() => { setExportMsg(null); setShowSheetModal(true); }}
              disabled={exportLoading}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-50 shrink-0"
            >
              Export to Sheet
            </button>
            <button
              onClick={() => runExport("xlsx")}
              disabled={exportLoading}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-50 shrink-0"
            >
              {exportLoading ? "Generating..." : "Download XLSX"}
            </button>
            <button
              onClick={exitSelectMode}
              disabled={exportLoading}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-muted text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50 shrink-0"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sheet URL Modal */}
      {showSheetModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => !exportLoading && setShowSheetModal(false)}
        >
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">Export to Google Sheet</h3>
              <span className="text-xs text-muted-foreground">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `All ${analysedTasks.length} profiles`}
              </span>
            </div>

            {sheetIntegrations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground font-medium">Saved Sheets</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {sheetIntegrations.map(sheet => {
                    const isActive = sheetUrl === sheet.url;
                    return (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => setSheetUrl(sheet.url)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
                          isActive
                            ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                            : "bg-muted border border-border text-foreground hover:border-muted-foreground"
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-emerald-400" : "bg-muted-foreground"}`} />
                        <span className="text-sm font-medium truncate">{sheet.name}</span>
                        {isActive && <span className="ml-auto text-[10px] text-emerald-400 shrink-0">Selected</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                {sheetIntegrations.length > 0 ? "Or enter URL manually" : "Apps Script Web App URL"}
              </label>
              <input
                autoFocus={sheetIntegrations.length === 0}
                type="text"
                placeholder="https://script.google.com/macros/s/..."
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
              />
              <p className="text-[10px] text-muted-foreground mt-1.5">Profiles are exported as a separate tab in your sheet</p>
            </div>
            {exportMsg && (
              <p className={`text-xs rounded-lg px-3 py-2 ${exportMsg.type === "success" ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                {exportMsg.text}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => runExport("sheet")}
                disabled={exportLoading || !sheetUrl.trim()}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
              >
                {exportLoading ? "Exporting..." : "Export"}
              </button>
              <button
                onClick={() => { setShowSheetModal(false); setExportMsg(null); }}
                disabled={exportLoading}
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function ProfileCard({ task, jobConfig, expanded, onToggle }: { task: TaskResult; jobConfig?: any; expanded: boolean; onToggle: () => void }) {
  const profile = task.result;
  const analysis = task.analysisResult;
  if (!profile) return null;

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Unknown";
  const headline = profile.headline || profile.occupation || "";
  const location = profile.location || "";
  const publicId = profile.public_identifier || "";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-accent/30 transition-colors"
      >
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-cyan-400 flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0 overflow-hidden">
          {profile.profile_picture_url ? (
            <img
              src={`/api/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`}
              alt={name}
              className="h-full w-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            `${(profile.first_name || "?")[0]}${(profile.last_name || "")[0] || ""}`
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-foreground font-medium truncate">{name}</p>
            {task.runIndex !== undefined && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted text-[10px] font-mono text-muted-foreground border border-border shrink-0">
                Run #{task.runIndex}
              </span>
            )}
            {task.addedAt && (
              <span className="text-[10px] text-muted-foreground/70 shrink-0">
                added {new Date(task.addedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">{headline}</p>
          {location && <p className="text-xs text-muted-foreground/70 truncate">{location}</p>}
        </div>

        {analysis && (
          <div className="text-center shrink-0">
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full border-2 ${
              analysis.scorePercent >= 70 ? "border-emerald-500 text-emerald-400"
              : analysis.scorePercent >= 40 ? "border-amber-500 text-amber-400"
              : "border-rose-500 text-rose-400"
            }`}>
              <span className="text-sm font-bold">{analysis.scorePercent}%</span>
            </div>
            <p className={`text-[10px] mt-0.5 font-medium ${
              analysis.recommendation === "Strong Fit" ? "text-emerald-400"
              : analysis.recommendation === "Moderate Fit" ? "text-amber-400"
              : "text-rose-400"
            }`}>{analysis.recommendation}</p>
          </div>
        )}

        <svg className={`w-5 h-5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {analysis && (
            <div className="space-y-4">
              {analysis.candidateInfo && (
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Candidate Info</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {analysis.candidateInfo.currentOrg && <InfoField label="Current Org" value={analysis.candidateInfo.currentOrg} />}
                    {analysis.candidateInfo.currentDesignation && <InfoField label="Designation" value={analysis.candidateInfo.currentDesignation} />}
                    {analysis.candidateInfo.totalExperienceYears > 0 && <InfoField label="Experience" value={`${analysis.candidateInfo.totalExperienceYears} yrs`} />}
                    {analysis.candidateInfo.companiesSwitched > 0 && <InfoField label="Companies" value={String(analysis.candidateInfo.companiesSwitched)} />}
                    {analysis.candidateInfo.stabilityAvgYears > 0 && <InfoField label="Avg Tenure" value={`${analysis.candidateInfo.stabilityAvgYears} yrs`} />}
                    {analysis.candidateInfo.currentLocation && <InfoField label="Location" value={analysis.candidateInfo.currentLocation} />}
                    {analysis.candidateInfo.btech && <InfoField label="BTech/BE" value={analysis.candidateInfo.btech} />}
                    {analysis.candidateInfo.graduation && <InfoField label="Graduation" value={analysis.candidateInfo.graduation} />}
                    {analysis.candidateInfo.mba && <InfoField label="MBA" value={analysis.candidateInfo.mba} />}
                    {analysis.candidateInfo.graduationYear && <InfoField label="Grad Year" value={String(analysis.candidateInfo.graduationYear)} />}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      analysis.scorePercent >= 70 ? "bg-emerald-500"
                      : analysis.scorePercent >= 40 ? "bg-amber-500"
                      : "bg-rose-500"
                    }`}
                    style={{ width: `${(analysis.totalScore / analysis.maxScore) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-foreground font-mono shrink-0">{analysis.totalScore}/{analysis.maxScore}</span>
              </div>

              {(() => {
                const jobConfig_ = jobConfig || {};
                const effectiveRules = getEffectiveRules({
                  scoringRules: analysis.enabledRules || jobConfig_.scoringRules,
                  customScoringRules: analysis.customScoringRules || jobConfig_.customScoringRules || [],
                  builtInRuleDescriptions: jobConfig_.builtInRuleDescriptions,
                  ruleDefinitions: jobConfig_.ruleDefinitions,
                }).filter(r => r.enabled);

                return (
                  <div className="bg-background/50 rounded-lg overflow-hidden">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider p-3 border-b border-border">Scoring Breakdown</p>
                    <div className="divide-y divide-border/50">
                      {effectiveRules.map(rule => {
                        const ruleMax = Math.max(0, ...rule.scoreParameters.map(p => p.maxPoints));
                        const val = rule.scoreParameters.reduce<number>((best, p) => {
                          const s = analysis.scoring?.[p.key];
                          return typeof s === "number" && s > best ? s : best;
                        }, 0);
                        const logText = analysis.scoringLogs?.[rule.key];
                        const isCustom = rule.type === "custom";
                        return (
                          <div key={rule.key} className="px-3 py-2 space-y-1">
                            <div className="flex items-center gap-3">
                              <span className={`text-xs w-36 shrink-0 ${isCustom ? "text-primary" : "text-muted-foreground"}`}>{rule.label}</span>
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${val >= ruleMax * 0.7 ? "bg-emerald-500" : val > 0 ? "bg-amber-500" : "bg-muted-foreground/30"}`}
                                  style={{ width: `${ruleMax > 0 ? (val / ruleMax) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono text-foreground w-12 text-right">{val}/{ruleMax}</span>
                            </div>
                            {logText && (
                              <p className="text-[11px] text-muted-foreground pl-[9.5rem] leading-relaxed">{logText}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.strengths?.length > 0 && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-emerald-400 mb-2">Strengths</p>
                    <ul className="space-y-1">{analysis.strengths.map((s: string, i: number) => <li key={i} className="text-xs text-foreground">• {s}</li>)}</ul>
                  </div>
                )}
                {analysis.gaps?.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-amber-400 mb-2">Gaps</p>
                    <ul className="space-y-1">{analysis.gaps.map((g: string, i: number) => <li key={i} className="text-xs text-foreground">• {g}</li>)}</ul>
                  </div>
                )}
              </div>

              {analysis.flags?.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-rose-400 mb-2">Red Flags / Disqualifiers</p>
                  <ul className="space-y-1">{analysis.flags.map((f: string, i: number) => <li key={i} className="text-xs text-foreground">• {f}</li>)}</ul>
                </div>
              )}

              {analysis.skillBreakdown && (
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Skills Analysis ({analysis.skillBreakdown.matchPercent}% Match)</p>
                  <div className="flex flex-wrap gap-1">
                    {(analysis.skillBreakdown.matchedSkills || []).map((s: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">{s}</span>
                    ))}
                    {(analysis.skillBreakdown.missingSkills || []).map((s: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/20">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {analysis.experienceSummary && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-primary mb-1">AI Summary</p>
                  <p className="text-xs text-foreground">{analysis.experienceSummary}</p>
                  {analysis.remarks && <p className="text-xs text-muted-foreground mt-1 italic">{analysis.remarks}</p>}
                </div>
              )}

              <details>
                <summary className="text-xs text-primary cursor-pointer hover:text-primary/80">View Scoring Logs</summary>
                <div className="mt-2 space-y-2">
                  {Object.entries(analysis.scoringLogs || {}).map(([key, log]) => (
                    <div key={key} className="bg-background/50 rounded-lg p-2">
                      <span className="text-[10px] text-primary font-medium uppercase">{key}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{log as string}</p>
                    </div>
                  ))}
                </div>
              </details>

              {analysis.__debug && (
                <details>
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Debug Info</summary>
                  <div className="mt-2 space-y-2">
                    <div className="bg-background/50 rounded-lg p-2">
                      <span className="text-[10px] text-muted-foreground font-medium">Model</span>
                      <p className="text-xs text-muted-foreground font-mono">{analysis.__debug.model}</p>
                    </div>
                    {analysis.__debug.usage && (() => {
                      const usage = analysis.__debug.usage;
                      const cost = estimateCost(usage.prompt_tokens, usage.completion_tokens, analysis.__debug.model);
                      return (
                        <div className="bg-background/50 rounded-lg p-2">
                          <span className="text-[10px] text-muted-foreground font-medium">Token Usage</span>
                          <p className="text-xs text-muted-foreground font-mono">Prompt: {usage.prompt_tokens} | Completion: {usage.completion_tokens} | Total: {usage.total_tokens}</p>
                          {cost ? (
                            <p className="text-xs text-emerald-400/80 font-mono mt-0.5">Cost: {formatCost(cost.totalCost)} (in {formatCost(cost.inputCost)} + out {formatCost(cost.outputCost)})</p>
                          ) : (
                            <p className="text-[10px] text-muted-foreground/60 mt-0.5">pricing unknown for {analysis.__debug.model}</p>
                          )}
                        </div>
                      );
                    })()}
                    {analysis.__debug.preComputed && (
                      <div className="bg-background/50 rounded-lg p-2">
                        <span className="text-[10px] text-muted-foreground font-medium">Pre-computed</span>
                        <p className="text-xs text-muted-foreground font-mono">Stability: {String(analysis.__debug.preComputed.stability)} | Location: {String(analysis.__debug.preComputed.location)}</p>
                      </div>
                    )}
                    <details className="ml-2">
                      <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">System Prompt</summary>
                      <pre className="mt-1 text-[10px] text-muted-foreground bg-background rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{analysis.__debug.systemPrompt}</pre>
                    </details>
                    <details className="ml-2">
                      <summary className="text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">User Prompt</summary>
                      <pre className="mt-1 text-[10px] text-muted-foreground bg-background rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{analysis.__debug.userPrompt}</pre>
                    </details>
                  </div>
                </details>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {publicId && <Field label="Profile ID" value={publicId} />}
            {profile.provider_id && <Field label="Provider ID" value={profile.provider_id} />}
            {profile.industry && <Field label="Industry" value={profile.industry} />}
            {profile.connections_count && <Field label="Connections" value={String(profile.connections_count)} />}
          </div>

          {profile.summary && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">About</p>
              <p className="text-sm text-foreground whitespace-pre-wrap line-clamp-4">{profile.summary}</p>
            </div>
          )}

          {profile.work_experience?.length > 0 && (
            <ExpandableList
              title="Experience"
              items={profile.work_experience}
              initialCount={3}
              renderItem={(exp: any, i: number) => (
                <div key={i} className="bg-background/50 rounded-lg p-3">
                  <p className="text-sm font-medium text-foreground">{exp.position || "Untitled Role"}</p>
                  <p className="text-xs text-muted-foreground">{exp.company || ""}</p>
                  {exp.start && <p className="text-xs text-muted-foreground/70 mt-0.5">{exp.start} – {exp.end || "Present"}</p>}
                </div>
              )}
            />
          )}

          {profile.education?.length > 0 && (
            <ExpandableList
              title="Education"
              items={profile.education}
              initialCount={2}
              renderItem={(edu: any, i: number) => (
                <div key={i} className="bg-background/50 rounded-lg p-3">
                  <p className="text-sm font-medium text-foreground">{edu.school || "Unknown School"}</p>
                  <p className="text-xs text-muted-foreground">{edu.degree || ""}</p>
                </div>
              )}
            />
          )}

          <details className="mt-2">
            <summary className="text-xs text-primary cursor-pointer hover:text-primary/80">View raw JSON</summary>
            <pre className="mt-2 text-xs text-muted-foreground bg-background rounded-lg p-3 overflow-x-auto max-h-64">{JSON.stringify(profile, null, 2)}</pre>
          </details>

          <a href={task.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80">
            Open LinkedIn Profile ↗
          </a>
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xs text-foreground">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background/50 rounded-lg p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground truncate">{value}</p>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 text-center">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ExpandableList({ title, items, initialCount, renderItem }: {
  title: string;
  items: any[];
  initialCount: number;
  renderItem: (item: any, index: number) => React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, initialCount);
  const remaining = items.length - initialCount;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-2">
        {visible.map((item, i) => renderItem(item, i))}
        {remaining > 0 && (
          <button onClick={() => setShowAll(!showAll)} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors">
            {showAll ? "Show less" : `+${remaining} more`}
          </button>
        )}
      </div>
    </div>
  );
}

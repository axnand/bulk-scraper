"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { estimateCost, formatCost } from "@/lib/model-pricing";

interface TaskResult {
  id: string;
  url: string;
  status: string;
  result: any;
  analysisResult: any;
  errorMessage: string | null;
  retryCount: number;
}

interface JobResults {
  id: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  config?: {
    sheetWebAppUrl: string;
    jdTitle: string;
    minScoreThreshold: number;
  };
  tasks: TaskResult[];
}

interface SheetIntegrationType {
  id: string;
  name: string;
  url: string;
}

export default function JobResultsPage() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [data, setData] = useState<JobResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // ── Export state ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetIntegrations, setSheetIntegrations] = useState<SheetIntegrationType[]>([]);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    async function fetchResults() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/results`);
        if (!res.ok) throw new Error("Failed to fetch results");
        const json = await res.json();
        setData(json);

        // Pre-populate sheet URL from job config on first load
        if (json.config?.sheetWebAppUrl) {
          setSheetUrl((prev) => prev || json.config.sheetWebAppUrl);
        }

        // Keep polling if still active (including paused, so UI stays in sync)
        if (json.status === "PROCESSING" || json.status === "PENDING" || json.status === "PAUSED") {
          // continue
        } else {
          clearInterval(interval);
        }
      } catch (err: any) {
        setError(err.message);
        clearInterval(interval);
      } finally {
        setLoading(false);
      }
    }

    // Load saved sheet integrations once on mount
    fetch("/api/sheet-integrations")
      .then((r) => r.ok ? r.json() : [])
      .then(setSheetIntegrations)
      .catch(() => {});

    fetchResults();
    interval = setInterval(fetchResults, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

  async function handleJobAction(action: "pause" | "resume" | "cancel") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const json = await res.json();
        setData((prev) => prev ? { ...prev, status: json.status } : prev);
      }
    } catch (err) {
      console.error(`Failed to ${action} job:`, err);
    } finally {
      setActionLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
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

      const res = await fetch(`/api/jobs/${jobId}/export`, {
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

  if (loading) {
    return (
      <main className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-neutral-800 rounded w-1/3"></div>
          <div className="h-4 bg-neutral-800 rounded w-1/2"></div>
          <div className="h-64 bg-neutral-800 rounded"></div>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="space-y-6">
        <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back to Home
        </Link>
        <div className="glassmorphism rounded-2xl p-6 text-center">
          <p className="text-rose-400">{error || "Job not found"}</p>
        </div>
      </main>
    );
  }

  const statusColors: Record<string, string> = {
    PENDING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PROCESSING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    FAILED: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    PAUSED: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    CANCELLED: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
    DONE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };

  const completedTasks = data.tasks.filter((t) => t.status === "DONE");
  const failedTasks = data.tasks.filter((t) => t.status === "FAILED");
  const pendingTasks = data.tasks.filter((t) => t.status === "PENDING" || t.status === "PROCESSING");
  const analysedTasks = completedTasks.filter((t) => t.analysisResult);
  const allAnalysedIds = analysedTasks.map((t) => t.id);
  const allSelected = allAnalysedIds.length > 0 && selectedIds.size === allAnalysedIds.length;

  return (
    <main className={`space-y-6 ${selectMode ? "pb-28" : ""}`}>
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm">
          ← Back
        </Link>
        <div className="flex-1" />
        <span className={`px-3 py-1 rounded-full text-xs font-medium border uppercase tracking-wider ${statusColors[data.status] || ""}`}>
          {data.status}
        </span>
      </div>

      {/* Job Controls */}
      {(data.status === "PENDING" || data.status === "PROCESSING" || data.status === "PAUSED") && (
        <div className="flex gap-2">
          {data.status === "PAUSED" ? (
            <button
              onClick={() => handleJobAction("resume")}
              disabled={actionLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
            >
              {actionLoading ? "Resuming..." : "Resume"}
            </button>
          ) : (
            <button
              onClick={() => handleJobAction("pause")}
              disabled={actionLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-50"
            >
              {actionLoading ? "Pausing..." : "Pause"}
            </button>
          )}
          <button
            onClick={() => handleJobAction("cancel")}
            disabled={actionLoading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 transition-colors disabled:opacity-50"
          >
            {actionLoading ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      )}

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-white">Job Results</h1>
        <p className="text-sm text-neutral-400 font-mono mt-1">ID: {data.id}</p>
      </header>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total" value={data.totalTasks} color="text-neutral-200" />
        <StatCard label="Success" value={data.successCount} color="text-emerald-400" />
        <StatCard label="Failed" value={data.failedCount} color="text-rose-400" />
      </div>

      {/* Completed Profiles */}
      {completedTasks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white shrink-0">
              Scraped Profiles ({completedTasks.length})
            </h2>
            {analysedTasks.length > 0 && !selectMode && (
              <button
                onClick={() => setSelectMode(true)}
                className="ml-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 hover:bg-indigo-500/25 transition-colors"
              >
                Select to export
              </button>
            )}
            {selectMode && (
              <button
                onClick={() => setSelectedIds(allSelected ? new Set() : new Set(allAnalysedIds))}
                className="ml-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
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
                onChange={(e) => setSearch(e.target.value)}
                className="bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-indigo-500 w-full max-w-xs"
              />
            )}
          </div>
          <div className="space-y-3">
            {completedTasks
              .filter((task) => {
                if (!search.trim()) return true;
                const profile = task.result;
                if (!profile) return false;
                const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.toLowerCase();
                return fullName.includes(search.toLowerCase().trim());
              })
              .map((task) => {
                const isSelected = selectedIds.has(task.id);
                const isSelectable = selectMode && !!task.analysisResult;
                return (
                  <div
                    key={task.id}
                    onClick={isSelectable ? () => toggleSelect(task.id) : undefined}
                    className={`relative rounded-xl transition-all ${
                      isSelectable ? "cursor-pointer" : ""
                    } ${
                      isSelected
                        ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-neutral-950"
                        : isSelectable
                        ? "ring-1 ring-neutral-700 hover:ring-indigo-500/50"
                        : ""
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3 z-10 h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center shadow-lg">
                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {isSelectable && !isSelected && (
                      <div className="absolute top-3 right-3 z-10 h-6 w-6 rounded-full border-2 border-neutral-600 bg-neutral-900/80" />
                    )}
                    <ProfileCard
                      task={task}
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

      {/* Failed Tasks */}
      {failedTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-rose-400">
            Failed ({failedTasks.length})
          </h2>
          <div className="space-y-2">
            {failedTasks.map((task) => (
              <div
                key={task.id}
                className="glassmorphism rounded-xl p-4 border-rose-500/20"
              >
                <p className="text-sm text-neutral-300 truncate">{task.url}</p>
                <p className="text-xs text-rose-400 mt-1">
                  {task.errorMessage || "Unknown error"}
                </p>
                {task.retryCount > 0 && (
                  <p className="text-xs text-neutral-500 mt-1">
                    Retried {task.retryCount} time(s)
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Pending/Processing */}
      {pendingTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-amber-400">
            In Progress ({pendingTasks.length})
          </h2>
          <div className="space-y-2">
            {pendingTasks.map((task) => (
              <div
                key={task.id}
                className="glassmorphism rounded-xl p-4 flex items-center gap-3"
              >
                <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                <p className="text-sm text-neutral-300 truncate flex-1">
                  {task.url}
                </p>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[task.status] || ""}`}>
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* ── Floating Export Bar ── */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-4 px-4 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-xl glassmorphism rounded-2xl border border-neutral-700 shadow-2xl px-5 py-4 flex items-center gap-3">
            <div className="shrink-0 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-7 px-2.5 rounded-full bg-indigo-500 text-white text-xs font-bold min-w-[28px]">
                {selectedIds.size}
              </span>
              <span className="text-sm text-neutral-300">
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
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/30 transition-colors disabled:opacity-50 shrink-0"
            >
              {exportLoading ? "Generating..." : "Download XLSX"}
            </button>
            <button
              onClick={exitSelectMode}
              disabled={exportLoading}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors disabled:opacity-50 shrink-0"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Sheet URL Modal ── */}
      {showSheetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={() => !exportLoading && setShowSheetModal(false)}>
          <div className="glassmorphism rounded-2xl p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Export to Google Sheet</h3>
              <span className="text-xs text-neutral-500">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `All ${analysedTasks.length} profiles`}
              </span>
            </div>

            {/* Saved sheet integrations */}
            {sheetIntegrations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-neutral-400 font-medium">Saved Sheets</p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {sheetIntegrations.map((sheet) => {
                    const isActive = sheetUrl === sheet.url;
                    return (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => setSheetUrl(sheet.url)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
                          isActive
                            ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-300"
                            : "bg-neutral-900/60 border border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800/60"
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-emerald-400" : "bg-neutral-600"}`} />
                        <span className="text-sm font-medium truncate">{sheet.name}</span>
                        {isActive && <span className="ml-auto text-[10px] text-emerald-400 shrink-0">Selected</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-neutral-400 block mb-1.5">
                {sheetIntegrations.length > 0 ? "Or enter URL manually" : "Apps Script Web App URL"}
              </label>
              <input
                autoFocus={sheetIntegrations.length === 0}
                type="text"
                placeholder="https://script.google.com/macros/s/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                className="w-full bg-neutral-900/50 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-neutral-500 mt-1.5">Profiles are exported as a separate tab in your sheet</p>
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
                className="px-4 py-2.5 rounded-lg text-sm font-medium bg-neutral-800 text-neutral-400 hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Profile Card Component ─────────────────────────────────────────
function ProfileCard({
  task,
  expanded,
  onToggle,
}: {
  task: TaskResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const profile = task.result;
  const analysis = task.analysisResult;
  if (!profile) return null;

  const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Unknown";
  const headline = profile.headline || profile.occupation || "";
  const location = profile.location || "";
  const publicId = profile.public_identifier || "";

  return (
    <div className="glassmorphism rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 flex items-center gap-4 hover:bg-neutral-800/30 transition-colors"
      >
        {/* Avatar */}
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold text-lg shrink-0 overflow-hidden">
          {profile.profile_picture_url ? (
            <img
              src={`/api/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`}
              alt={name}
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            `${(profile.first_name || "?")[0]}${(profile.last_name || "")[0] || ""}`
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-white font-medium truncate">{name}</p>
          <p className="text-sm text-neutral-400 truncate">{headline}</p>
          {location && (
            <p className="text-xs text-neutral-500 truncate">{location}</p>
          )}
        </div>

        {/* Analysis Score Badge */}
        {analysis && (
          <div className="text-center shrink-0">
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full border-2 ${
              analysis.scorePercent >= 70 ? 'border-emerald-500 text-emerald-400'
              : analysis.scorePercent >= 40 ? 'border-amber-500 text-amber-400'
              : 'border-rose-500 text-rose-400'
            }`}>
              <span className="text-sm font-bold">{analysis.scorePercent}%</span>
            </div>
            <p className={`text-[10px] mt-0.5 font-medium ${
              analysis.recommendation === 'Strong Fit' ? 'text-emerald-400'
              : analysis.recommendation === 'Moderate Fit' ? 'text-amber-400'
              : 'text-rose-400'
            }`}>{analysis.recommendation}</p>
          </div>
        )}

        <svg
          className={`w-5 h-5 text-neutral-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-neutral-800 p-4 space-y-4">

          {/* ── Analysis Results (if available) ── */}
          {analysis && (
            <div className="space-y-4">
              {/* Candidate Info */}
              {analysis.candidateInfo && (
                <div className="bg-neutral-900/50 rounded-lg p-3">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Candidate Info</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {analysis.candidateInfo.currentOrg && (
                      <div><p className="text-[10px] text-neutral-500">Current Org</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.currentOrg}</p></div>
                    )}
                    {analysis.candidateInfo.currentDesignation && (
                      <div><p className="text-[10px] text-neutral-500">Designation</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.currentDesignation}</p></div>
                    )}
                    {analysis.candidateInfo.totalExperienceYears > 0 && (
                      <div><p className="text-[10px] text-neutral-500">Experience</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.totalExperienceYears} yrs</p></div>
                    )}
                    {analysis.candidateInfo.companiesSwitched > 0 && (
                      <div><p className="text-[10px] text-neutral-500">Companies Switched</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.companiesSwitched}</p></div>
                    )}
                    {analysis.candidateInfo.stabilityAvgYears > 0 && (
                      <div><p className="text-[10px] text-neutral-500">Avg Tenure</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.stabilityAvgYears} yrs</p></div>
                    )}
                    {analysis.candidateInfo.currentLocation && (
                      <div><p className="text-[10px] text-neutral-500">Location</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.currentLocation}</p></div>
                    )}
                    {analysis.candidateInfo.btech && (
                      <div><p className="text-[10px] text-neutral-500">BTech/BE</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.btech}</p></div>
                    )}
                    {analysis.candidateInfo.graduation && (
                      <div><p className="text-[10px] text-neutral-500">Graduation</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.graduation}</p></div>
                    )}
                    {analysis.candidateInfo.mba && (
                      <div><p className="text-[10px] text-neutral-500">MBA</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.mba}</p></div>
                    )}
                    {analysis.candidateInfo.graduationYear && (
                      <div><p className="text-[10px] text-neutral-500">Grad Year</p><p className="text-xs text-neutral-200">{analysis.candidateInfo.graduationYear}</p></div>
                    )}
                  </div>
                </div>
              )}

              {/* Score Summary Bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      analysis.scorePercent >= 70 ? 'bg-emerald-500'
                      : analysis.scorePercent >= 40 ? 'bg-amber-500'
                      : 'bg-rose-500'
                    }`}
                    style={{ width: `${(analysis.totalScore / analysis.maxScore) * 100}%` }}
                  />
                </div>
                <span className="text-sm text-neutral-300 font-mono shrink-0">
                  {analysis.totalScore}/{analysis.maxScore}
                </span>
              </div>

              {/* Scoring Breakdown Table */}
              <div className="bg-neutral-900/50 rounded-lg overflow-hidden">
                <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider p-3 border-b border-neutral-800">Scoring Breakdown</p>
                <div className="divide-y divide-neutral-800/50">
                  {[
                    { label: 'Stability', logKey: 'stability', scoreKey1: 'stability', max: 10 },
                    { label: 'Growth', logKey: 'growth', scoreKey1: 'promotionSameCompany', scoreKey2: 'promotionWithChange', max: 15 },
                    { label: 'Graduation', logKey: 'graduation', scoreKey1: 'gradTier1', scoreKey2: 'gradTier2', max: 15 },
                    { label: 'Company Type', logKey: 'companyType', scoreKey1: 'salesCRM', scoreKey2: 'otherB2B', max: 15 },
                    { label: 'MBA', logKey: 'mba', scoreKey1: "mbaA", scoreKey2: "mbaOthers", max: 15 },
                    { label: 'Skillset Match', logKey: 'skillMatch', scoreKey1: 'skillsetMatch', max: 10 },
                    { label: 'Location', logKey: 'location', scoreKey1: 'locationMatch', max: 5 },
                  ].filter(d => analysis.scoringLogs && analysis.scoringLogs[d.logKey] !== undefined).map(dim => {
                    let val = 0;
                    if (typeof analysis.scoring[dim.scoreKey1] === 'number') {
                      val = analysis.scoring[dim.scoreKey1];
                    } else if (dim.scoreKey2 && typeof analysis.scoring[dim.scoreKey2] === 'number') {
                      val = analysis.scoring[dim.scoreKey2];
                    }
                    return (
                      <div key={dim.logKey} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-xs text-neutral-400 w-36 shrink-0">{dim.label}</span>
                        <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${
                            val >= dim.max * 0.7 ? 'bg-emerald-500' : val > 0 ? 'bg-amber-500' : 'bg-neutral-700'
                          }`} style={{ width: `${dim.max > 0 ? (val / dim.max) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs font-mono text-neutral-300 w-12 text-right">{val}/{dim.max}</span>
                      </div>
                    );
                  })}
                  {/* Custom rules */}
                  {(analysis.customScoringRules || []).map((r: any) => {
                    const val = typeof analysis.scoring[`custom_${r.id}`] === 'number' ? analysis.scoring[`custom_${r.id}`] : 0;
                    return (
                      <div key={r.id} className="flex items-center gap-3 px-3 py-2">
                        <span className="text-xs text-indigo-400 w-36 shrink-0">{r.name}</span>
                        <div className="flex-1 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${r.maxPoints > 0 ? (val / r.maxPoints) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs font-mono text-neutral-300 w-12 text-right">{val}/{r.maxPoints}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Strengths & Gaps */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.strengths?.length > 0 && (
                  <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-emerald-400 mb-2">Strengths</p>
                    <ul className="space-y-1">
                      {analysis.strengths.map((s: string, i: number) => (
                        <li key={i} className="text-xs text-neutral-300">• {s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.gaps?.length > 0 && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    <p className="text-xs font-medium text-amber-400 mb-2">Gaps</p>
                    <ul className="space-y-1">
                      {analysis.gaps.map((g: string, i: number) => (
                        <li key={i} className="text-xs text-neutral-300">• {g}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Flags */}
              {analysis.flags?.length > 0 && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-rose-400 mb-2">Red Flags / Disqualifiers</p>
                  <ul className="space-y-1">
                    {analysis.flags.map((f: string, i: number) => (
                      <li key={i} className="text-xs text-neutral-300">• {f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Skill Breakdown */}
              {analysis.skillBreakdown && (
                <div className="bg-neutral-900/50 rounded-lg p-3">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Skills Analysis ({analysis.skillBreakdown.matchPercent}% Match)</p>
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

              {/* AI Summary */}
              {analysis.experienceSummary && (
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-indigo-400 mb-1">AI Summary</p>
                  <p className="text-xs text-neutral-300">{analysis.experienceSummary}</p>
                  {analysis.remarks && (
                    <p className="text-xs text-neutral-400 mt-1 italic">{analysis.remarks}</p>
                  )}
                </div>
              )}

              {/* Scoring Logs (collapsible) */}
              <details>
                <summary className="text-xs text-indigo-400 cursor-pointer hover:text-indigo-300">View Scoring Logs</summary>
                <div className="mt-2 space-y-2">
                  {Object.entries(analysis.scoringLogs || {}).map(([key, log]) => (
                    <div key={key} className="bg-neutral-900/50 rounded-lg p-2">
                      <span className="text-[10px] text-indigo-400 font-medium uppercase">{key}</span>
                      <p className="text-xs text-neutral-400 mt-0.5">{log as string}</p>
                    </div>
                  ))}
                </div>
              </details>

              {/* Debug Info (collapsible) */}
              {analysis.__debug && (
                <details>
                  <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-400">Debug Info</summary>
                  <div className="mt-2 space-y-2">
                    <div className="bg-neutral-900/50 rounded-lg p-2">
                      <span className="text-[10px] text-neutral-500 font-medium">Model</span>
                      <p className="text-xs text-neutral-400 font-mono">{analysis.__debug.model}</p>
                    </div>
                    {analysis.__debug.usage && (() => {
                      const usage = analysis.__debug.usage;
                      const cost = estimateCost(usage.prompt_tokens, usage.completion_tokens, analysis.__debug.model);
                      return (
                        <div className="bg-neutral-900/50 rounded-lg p-2">
                          <span className="text-[10px] text-neutral-500 font-medium">Token Usage</span>
                          <p className="text-xs text-neutral-400 font-mono">
                            Prompt: {usage.prompt_tokens} | Completion: {usage.completion_tokens} | Total: {usage.total_tokens}
                          </p>
                          {cost ? (
                            <p className="text-xs text-emerald-400/80 font-mono mt-0.5">
                              Cost: {formatCost(cost.totalCost)} (in {formatCost(cost.inputCost)} + out {formatCost(cost.outputCost)})
                            </p>
                          ) : (
                            <p className="text-[10px] text-neutral-600 mt-0.5">pricing unknown for {analysis.__debug.model}</p>
                          )}
                        </div>
                      );
                    })()}
                    {analysis.__debug.preComputed && (
                      <div className="bg-neutral-900/50 rounded-lg p-2">
                        <span className="text-[10px] text-neutral-500 font-medium">Pre-computed</span>
                        <p className="text-xs text-neutral-400 font-mono">
                          Stability: {String(analysis.__debug.preComputed.stability)} | Location: {String(analysis.__debug.preComputed.location)}
                        </p>
                      </div>
                    )}
                    <details className="ml-2">
                      <summary className="text-[10px] text-neutral-600 cursor-pointer hover:text-neutral-500">System Prompt</summary>
                      <pre className="mt-1 text-[10px] text-neutral-500 bg-neutral-950 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{analysis.__debug.systemPrompt}</pre>
                    </details>
                    <details className="ml-2">
                      <summary className="text-[10px] text-neutral-600 cursor-pointer hover:text-neutral-500">User Prompt</summary>
                      <pre className="mt-1 text-[10px] text-neutral-500 bg-neutral-950 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">{analysis.__debug.userPrompt}</pre>
                    </details>
                  </div>
                </details>
              )}
            </div>
          )}

          {/* ── Raw Profile Data ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {publicId && <Field label="Profile ID" value={publicId} />}
            {profile.provider_id && <Field label="Provider ID" value={profile.provider_id} />}
            {profile.industry && <Field label="Industry" value={profile.industry} />}
            {profile.connections_count && (
              <Field label="Connections" value={String(profile.connections_count)} />
            )}
          </div>

          {/* About */}
          {profile.summary && (
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">About</p>
              <p className="text-sm text-neutral-300 whitespace-pre-wrap line-clamp-4">{profile.summary}</p>
            </div>
          )}

          {/* Experience */}
          {profile.work_experience && profile.work_experience.length > 0 && (
            <ExpandableList
              title="Experience"
              items={profile.work_experience}
              initialCount={3}
              renderItem={(exp: any, i: number) => (
                <div key={i} className="bg-neutral-900/50 rounded-lg p-3">
                  <p className="text-sm font-medium text-neutral-200">{exp.position || 'Untitled Role'}</p>
                  <p className="text-xs text-neutral-400">{exp.company || ''}</p>
                  {exp.start && (
                    <p className="text-xs text-neutral-500 mt-0.5">{exp.start} – {exp.end || 'Present'}</p>
                  )}
                </div>
              )}
            />
          )}

          {/* Education */}
          {profile.education && profile.education.length > 0 && (
            <ExpandableList
              title="Education"
              items={profile.education}
              initialCount={2}
              renderItem={(edu: any, i: number) => (
                <div key={i} className="bg-neutral-900/50 rounded-lg p-3">
                  <p className="text-sm font-medium text-neutral-200">{edu.school || 'Unknown School'}</p>
                  <p className="text-xs text-neutral-400">{edu.degree || ''}</p>
                </div>
              )}
            />
          )}

          {/* Raw JSON toggle */}
          <details className="mt-2">
            <summary className="text-xs text-indigo-400 cursor-pointer hover:text-indigo-300">View raw JSON</summary>
            <pre className="mt-2 text-xs text-neutral-400 bg-neutral-950 rounded-lg p-3 overflow-x-auto max-h-64">
              {JSON.stringify(profile, null, 2)}
            </pre>
          </details>

          {/* Source URL */}
          <a
            href={task.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
          >
            Open LinkedIn Profile ↗
          </a>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-neutral-900/50 rounded-lg p-2">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm text-neutral-200 truncate">{value}</p>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="glassmorphism rounded-xl p-3 text-center">
      <p className="text-xs text-neutral-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ExpandableList({
  title,
  items,
  initialCount,
  renderItem,
}: {
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
      <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-2">
        {visible.map((item, i) => renderItem(item, i))}
        {remaining > 0 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
          >
            {showAll ? "Show less" : `+${remaining} more`}
          </button>
        )}
      </div>
    </div>
  );
}

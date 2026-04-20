"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pause, Play, XCircle, Eye, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getEffectiveRules } from "@/lib/analyzer";
import { cn } from "@/lib/utils";

interface RunSummary {
  id: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
}

interface RunTask {
  id: string;
  url: string;
  status: string;
  result: any;
  analysisResult: any;
  errorMessage: string | null;
  retryCount: number;
  hasResume?: boolean;
}

interface RunDetail {
  id: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
  config?: any;
  tasks: RunTask[];
}

interface Props {
  runs: RunSummary[];
  onRunAction: (runId: string, action: "pause" | "resume" | "cancel") => Promise<void>;
  actionLoading: boolean;
}

const ACTIVE_STATUSES = new Set(["PENDING", "PROCESSING", "PAUSED"]);

const statusColors: Record<string, string> = {
  PENDING: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PROCESSING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  COMPLETED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  FAILED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  PAUSED: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  CANCELLED: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function HistoryTab({ runs, onRunAction, actionLoading }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const lastRunRef = useRef<{ run: RunSummary; number: number } | null>(null);

  if (runs.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
          <CheckCircle2 className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold text-foreground">No runs yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add candidates to start your first run. Each batch appears here with its own stats and failures.
        </p>
      </div>
    );
  }

  async function handleCancel(runId: string) {
    if (!window.confirm("Cancel this run? Running tasks will be marked failed.")) return;
    console.log(`[HistoryTab] Cancelling run=${runId.slice(-6)}`);
    await onRunAction(runId, "cancel");
  }

  function openDrawer(run: RunSummary, runNumber: number) {
    lastRunRef.current = { run, number: runNumber };
    setDrawerRunId(run.id);
    setSheetOpen(true);
  }

  const activeRunEntry = drawerRunId ? runs.find(r => r.id === drawerRunId) : null;
  if (activeRunEntry) {
    const idx = runs.findIndex(r => r.id === drawerRunId);
    lastRunRef.current = { run: activeRunEntry, number: runs.length - idx };
  }
  const drawerContent = lastRunRef.current;

  return (
    <div className="w-full">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Run History</h2>
          <p className="text-sm text-muted-foreground">
            {runs.length} {runs.length === 1 ? "run" : "runs"} · newest first
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {runs.map((run, idx) => {
          const runNumber = runs.length - idx;
          const pct = run.totalTasks > 0
            ? Math.min(100, Math.round((run.processedCount / run.totalTasks) * 100))
            : 0;
          const isActive = ACTIVE_STATUSES.has(run.status);

          return (
            <div
              key={run.id}
              onClick={() => openDrawer(run, runNumber)}
              className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">Run #{runNumber}</span>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] uppercase tracking-wide gap-1.5", statusColors[run.status] || "")}
                  >
                    {isActive && run.status === "PROCESSING" && (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                    )}
                    {run.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(run.createdAt)} · {relativeTime(run.createdAt)}
                  </span>
                </div>

                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  {isActive && (
                    <>
                      {run.status === "PAUSED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRunAction(run.id, "resume")}
                          disabled={actionLoading}
                          className="gap-1.5 h-8"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Resume
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onRunAction(run.id, "pause")}
                          disabled={actionLoading}
                          className="gap-1.5 h-8"
                        >
                          <Pause className="h-3.5 w-3.5" />
                          Pause
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancel(run.id)}
                        disabled={actionLoading}
                        className="gap-1.5 h-8 text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    </>
                  )}
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <span className="text-emerald-400">
                  {run.successCount} success
                </span>
                <span className="text-rose-400">
                  {run.failedCount} failed
                </span>
                <span className="text-muted-foreground">
                  {run.processedCount} / {run.totalTasks} processed
                </span>
                <span className="font-mono text-muted-foreground ml-auto shrink-0">{pct}%</span>
              </div>

              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    run.status === "PAUSED" ? "bg-violet-500"
                      : run.status === "FAILED" ? "bg-rose-500"
                      : run.status === "CANCELLED" ? "bg-neutral-500"
                      : run.status === "COMPLETED" ? "bg-emerald-500"
                      : run.status === "PENDING" ? "bg-blue-500"
                      : "bg-amber-500"
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <Sheet open={sheetOpen} onOpenChange={o => { if (!o) setSheetOpen(false); }}>
        <SheetContent
          side="right"
          className="w-[min(720px,90vw)] sm:max-w-none overflow-y-auto p-0"
        >
          {drawerContent && (
            <RunDetailDrawer run={drawerContent.run} runNumber={drawerContent.number} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RunDetailDrawer({ run, runNumber }: { run: RunSummary; runNumber: number }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  async function fetchDetail() {
    const t = Date.now();
    try {
      const res = await fetch(`/api/jobs/${run.id}/results`);
      if (!res.ok) {
        console.error(`[HistoryDrawer] fetchDetail FAILED — run=${run.id.slice(-6)} status=${res.status}`);
        return;
      }
      const data = await res.json();
      const pending = data.tasks?.filter((t: any) => t.status === "PENDING").length ?? 0;
      const processing = data.tasks?.filter((t: any) => t.status === "PROCESSING").length ?? 0;
      const done = data.tasks?.filter((t: any) => t.status === "DONE").length ?? 0;
      const failed = data.tasks?.filter((t: any) => t.status === "FAILED").length ?? 0;
      console.log(
        `[HistoryDrawer] fetchDetail OK (${Date.now() - t}ms) — run=${run.id.slice(-6)} ` +
        `jobStatus=${data.status} PENDING=${pending} PROCESSING=${processing} DONE=${done} FAILED=${failed}`
      );

      // Log Unipile step info for any tasks currently in PROCESSING
      const processingTasks = (data.tasks ?? []).filter((t: any) => t.status === "PROCESSING");
      for (const pt of processingTasks) {
        let stepInfo: any = null;
        try { stepInfo = pt.result ? JSON.parse(pt.result) : null; } catch { /* ignore */ }
        if (stepInfo?._step) {
          const stepAge = stepInfo._stepAt
            ? `${Math.round((Date.now() - new Date(stepInfo._stepAt).getTime()) / 1000)}s ago`
            : "";
          const stepLabel: Record<string, string> = {
            jitter:            "⏳ Waiting (jitter delay)...",
            unipile_fetching:  "🌐 Calling Unipile API...",
            unipile_done:      `✅ Unipile done (${stepInfo.fetchMs}ms) — name="${stepInfo.name}"`,
            unipile_error:     `❌ Unipile error — ${stepInfo.error} (${stepInfo.elapsedMs}ms)`,
            saving_profile:    "💾 Saving profile to DB...",
            ai_analyzing:      `🤖 AI analysis running (model=${stepInfo.aiModel})...`,
          };
          console.log(
            `[Unipile] task=${pt.id?.slice(-6)} step="${stepInfo._step}" — ${stepLabel[stepInfo._step] ?? stepInfo._step} ${stepAge}`
          );
        }
      }

      setDetail(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    console.log(`[HistoryDrawer] Opened — run=${run.id.slice(-6)} status=${run.status}`);
    setLoading(true);
    setExpandedTask(null);
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  useEffect(() => {
    if (!detail) return;
    if (!ACTIVE_STATUSES.has(detail.status)) return;
    console.log(`[HistoryDrawer] ⏱️ Starting drawer poll (every 3s) — run=${run.id.slice(-6)} status=${detail.status}`);
    const interval = setInterval(() => {
      console.log(`[HistoryDrawer] 🔁 Drawer poll tick — run=${run.id.slice(-6)} status=${detail.status}`);
      fetchDetail();
    }, 3000);
    return () => {
      console.log(`[HistoryDrawer] ⏹️ Stopping drawer poll — run=${run.id.slice(-6)}`);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.status, run.id]);

  const tasks = detail?.tasks ?? [];
  const successful = tasks.filter(t => t.status === "DONE");
  const failed = tasks.filter(t => t.status === "FAILED");
  const inProgress = tasks.filter(t => t.status === "PENDING" || t.status === "PROCESSING");

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="p-6 border-b border-border shrink-0">
        <SheetTitle className="flex items-center gap-3 flex-wrap">
          <span>Run #{runNumber}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px] uppercase tracking-wide", statusColors[run.status] || "")}
          >
            {run.status}
          </Badge>
        </SheetTitle>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(run.createdAt)}
        </p>
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Stat label="Total" value={run.totalTasks} color="text-foreground" />
          <Stat label="Success" value={run.successCount} color="text-emerald-400" />
          <Stat label="Failed" value={run.failedCount} color="text-rose-400" />
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {loading && !detail ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {failed.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  Failed ({failed.length})
                </h3>
                <div className="space-y-2">
                  {failed.map(t => (
                    <div key={t.id} className="bg-card border border-rose-500/20 rounded-lg p-3">
                      <p className="text-xs text-foreground break-all">{t.url}</p>
                      <p className="text-xs text-rose-400 mt-1">{t.errorMessage || "Unknown error"}</p>
                      {t.retryCount > 0 && (
                        <p className="text-[10px] text-muted-foreground mt-1">Retried {t.retryCount} time(s)</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {inProgress.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-amber-400 flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  In Progress ({inProgress.length})
                </h3>
                <div className="space-y-2">
                  {inProgress.map(t => (
                    <div key={t.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
                      <span className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        t.status === "PROCESSING" ? "bg-amber-400 animate-pulse" : "bg-blue-400"
                      )} />
                      <p className="text-xs text-foreground truncate flex-1">{t.url}</p>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                        {t.status}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {successful.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4" />
                  Successful ({successful.length})
                </h3>
                {/* Table header */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="grid grid-cols-[1fr_auto] items-center px-3 py-1.5 bg-muted/40 border-b border-border/60">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Candidate</span>
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground text-right">Score</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {successful.map(t => (
                      <HistoryProfileRow
                        key={t.id}
                        task={t}
                        jobConfig={detail?.config}
                        expanded={expandedTask === t.id}
                        onToggle={() => setExpandedTask(expandedTask === t.id ? null : t.id)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            )}

            {tasks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No tasks in this run yet.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HistoryProfileRow({
  task,
  jobConfig,
  expanded,
  onToggle,
}: {
  task: RunTask;
  jobConfig?: any;
  expanded: boolean;
  onToggle: () => void;
}) {
  const profile = task.result;
  const analysis = task.analysisResult;
  if (!profile) return null;

  const extracted = profile.extractedInfo || {};
  const scrapedName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  const name = scrapedName || extracted.name || analysis?.candidateInfo?.name || "Unknown";
  const info = analysis?.candidateInfo;
  const location = info?.currentLocation || profile.location || extracted.currentLocation || "";
  const headline = profile.headline || profile.occupation || extracted.currentDesignation || "";
  const designation = info?.currentDesignation || headline;
  const org = info?.currentOrg || "";
  const exp = info?.totalExperienceYears;
  const scorePercent = analysis?.scorePercent;

  return (
    <>
      {/* Slim row */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30 transition-colors"
      >
        {/* Name + meta */}
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/candidates/${task.id}`}
                onClick={e => e.stopPropagation()}
                className="text-sm font-medium text-foreground hover:text-primary hover:underline transition-colors truncate"
              >
                {name}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {[designation, org].filter(Boolean).join(" · ")}
              {location ? ` · ${location}` : ""}
              {exp ? ` · ${exp} yrs` : ""}
            </p>
          </div>
        </div>

        {/* Score */}
        {analysis && (
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn(
              "text-sm font-bold tabular-nums",
              scorePercent >= 70 ? "text-emerald-500" : scorePercent >= 40 ? "text-amber-500" : "text-rose-500"
            )}>
              {scorePercent}%
            </span>
            <span className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
              analysis.recommendation === "Strong Fit"
                ? "bg-emerald-500/10 text-emerald-500"
                : analysis.recommendation === "Moderate Fit"
                ? "bg-amber-500/10 text-amber-500"
                : "bg-rose-500/10 text-rose-500"
            )}>
              {analysis.recommendation}
            </span>
          </div>
        )}

        <svg
          className={cn("w-4 h-4 text-muted-foreground transition-transform shrink-0", expanded && "rotate-180")}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 px-4 py-4 space-y-4">
          {analysis && (
            <>
              {/* Scoring breakdown */}
              {(() => {
                const effectiveRules = getEffectiveRules({
                  scoringRules: analysis.enabledRules || jobConfig?.scoringRules,
                  customScoringRules: analysis.customScoringRules || jobConfig?.customScoringRules || [],
                  builtInRuleDescriptions: jobConfig?.builtInRuleDescriptions,
                  ruleDefinitions: jobConfig?.ruleDefinitions,
                }).filter((r: any) => r.enabled);

                return (
                  <div className="rounded-lg border border-border overflow-hidden bg-background">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border/60">Scoring</p>
                    <div className="divide-y divide-border/40">
                      {effectiveRules.map((rule: any) => {
                        const ruleMax = Math.max(0, ...rule.scoreParameters.map((p: any) => p.maxPoints));
                        const val = (rule.scoreParameters as any[]).reduce<number>((best: number, p: any) => {
                          const s = analysis.scoring?.[p.key];
                          return typeof s === "number" && s > best ? s : best;
                        }, 0);
                        const logText = analysis.scoringLogs?.[rule.key];
                        return (
                          <div key={rule.key} className="px-3 py-2 space-y-1">
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-28 shrink-0">{rule.label}</span>
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full", val >= ruleMax * 0.7 ? "bg-emerald-500" : val > 0 ? "bg-amber-500" : "bg-muted-foreground/30")}
                                  style={{ width: `${ruleMax > 0 ? (val / ruleMax) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono text-foreground w-10 text-right shrink-0">{val}/{ruleMax}</span>
                            </div>
                            {logText && <p className="text-[11px] text-muted-foreground pl-30 leading-relaxed">{logText}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Strengths / Gaps inline */}
              {(analysis.strengths?.length > 0 || analysis.gaps?.length > 0) && (
                <div className="grid grid-cols-2 gap-3">
                  {analysis.strengths?.length > 0 && (
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-500 mb-1.5">Strengths</p>
                      <ul className="space-y-1">
                        {analysis.strengths.map((s: string, i: number) => (
                          <li key={i} className="text-xs text-foreground leading-snug">• {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {analysis.gaps?.length > 0 && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-500 mb-1.5">Gaps</p>
                      <ul className="space-y-1">
                        {analysis.gaps.map((g: string, i: number) => (
                          <li key={i} className="text-xs text-foreground leading-snug">• {g}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* AI Summary */}
              {analysis.experienceSummary && (
                <p className="text-xs text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-3">{analysis.experienceSummary}</p>
              )}
            </>
          )}

          {/* Footer links */}
          <div className="flex items-center gap-4 pt-1">
            <Link
              href={`/candidates/${task.id}`}
              onClick={e => e.stopPropagation()}
              className="text-xs font-medium text-primary hover:underline"
            >
              View full profile ↗
            </Link>
            {task.hasResume && (
              <a
                href={`/api/tasks/${task.id}/resume`}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:text-primary"
              >
                View Resume ↗
              </a>
            )}
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary"
              >
                LinkedIn ↗
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-2 text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={cn("text-lg font-bold", color)}>{value}</p>
    </div>
  );
}

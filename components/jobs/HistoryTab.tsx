"use client";

import { useEffect, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pause, Play, XCircle, Eye, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
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
}

interface RunDetail {
  id: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
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
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);

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
    await onRunAction(runId, "cancel");
  }

  const drawerRun = drawerRunId ? runs.find(r => r.id === drawerRunId) ?? null : null;
  const drawerRunIndex = drawerRunId ? runs.findIndex(r => r.id === drawerRunId) : -1;
  const drawerRunNumber = drawerRunIndex >= 0 ? runs.length - drawerRunIndex : 0;

  return (
    <div className="max-w-5xl">
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
              className="bg-card border border-border rounded-xl p-4 space-y-3 hover:border-muted-foreground/30 transition-colors"
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

                <div className="flex items-center gap-2">
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
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDrawerRunId(run.id)}
                    className="gap-1.5 h-8"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </Button>
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

      <Sheet open={drawerRun !== null} onOpenChange={o => !o && setDrawerRunId(null)}>
        <SheetContent
          side="right"
          className="w-[min(720px,90vw)] sm:max-w-none overflow-y-auto p-0"
        >
          {drawerRun && (
            <RunDetailDrawer run={drawerRun} runNumber={drawerRunNumber} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RunDetailDrawer({ run, runNumber }: { run: RunSummary; runNumber: number }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchDetail() {
    try {
      const res = await fetch(`/api/jobs/${run.id}/results`);
      if (!res.ok) return;
      const data = await res.json();
      setDetail(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id]);

  useEffect(() => {
    if (!detail) return;
    if (!ACTIVE_STATUSES.has(detail.status)) return;
    const interval = setInterval(fetchDetail, 3000);
    return () => clearInterval(interval);
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
              <div key={i} className="h-14 rounded-lg bg-card border border-border animate-pulse" />
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
                <div className="space-y-2">
                  {successful.map(t => <SuccessRow key={t.id} task={t} />)}
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

function SuccessRow({ task }: { task: RunTask }) {
  const profile = task.result;
  const analysis = task.analysisResult;
  const name = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Unknown"
    : task.url;
  const headline = profile?.headline || profile?.occupation || "";

  return (
    <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-cyan-400 flex items-center justify-center text-primary-foreground font-bold text-xs shrink-0 overflow-hidden">
        {profile?.profile_picture_url ? (
          <img
            src={`/api/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`}
            alt={name}
            className="h-full w-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          `${(profile?.first_name || "?")[0] || "?"}${(profile?.last_name || "")[0] || ""}`
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{name}</p>
        {headline && <p className="text-[11px] text-muted-foreground truncate">{headline}</p>}
      </div>
      {analysis && (
        <div className={cn(
          "inline-flex items-center justify-center h-9 w-9 rounded-full border-2 text-xs font-bold shrink-0",
          analysis.scorePercent >= 70 ? "border-emerald-500 text-emerald-400"
            : analysis.scorePercent >= 40 ? "border-amber-500 text-amber-400"
            : "border-rose-500 text-rose-400"
        )}>
          {analysis.scorePercent}%
        </div>
      )}
    </div>
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

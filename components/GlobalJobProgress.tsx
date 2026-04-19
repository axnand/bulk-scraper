"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Activity, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  requisitionId: string | null;
  title: string;
  department: string;
  status: string;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
}

const STORAGE_KEY = "globalJobProgress.collapsed";
const ACTIVE_STATUSES = new Set(["PROCESSING", "PENDING", "PAUSED"]);

export function GlobalJobProgress() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    setMounted(true);
    try {
      setCollapsed(sessionStorage.getItem(STORAGE_KEY) === "1");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch("/api/jobs?page=1&limit=20");
        if (!res.ok) return;
        const data = await res.json();
        if (!alive) return;
        const active = (data.jobs || []).filter((j: Job) => ACTIVE_STATUSES.has(j.status));
        setJobs(active);
      } catch { /* ignore */ }
    }

    pollRef.current = poll;
    poll();
    const interval = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch { /* ignore */ }
  }

  async function runAction(jobId: string, action: "pause" | "resume" | "cancel") {
    if (action === "cancel") {
      if (!window.confirm("Cancel this run? Running tasks will be marked failed.")) return;
    }
    setActionLoading(prev => ({ ...prev, [jobId]: true }));
    try {
      await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await pollRef.current();
    } finally {
      setActionLoading(prev => {
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    }
  }

  function openJob(job: Job) {
    if (job.requisitionId) {
      const short = `JD-${job.requisitionId.slice(0, 8).toUpperCase()}`;
      router.push(`/jobs/${short}?tab=history`);
    } else {
      router.push(`/jobs/${job.id}`);
    }
  }

  if (!mounted || jobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border hover:bg-accent/40 transition-colors"
      >
        <Activity className="h-4 w-4 text-amber-500 animate-pulse" />
        <span className="text-sm font-medium text-foreground flex-1 text-left">
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"} processing
        </span>
        {collapsed ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="max-h-[50vh] overflow-y-auto divide-y divide-border">
          {jobs.map(job => {
            const pct = job.totalTasks > 0
              ? Math.min(100, Math.round((job.processedCount / job.totalTasks) * 100))
              : 0;
            const isPending = job.status === "PENDING";
            const isPaused = job.status === "PAUSED";
            const busy = !!actionLoading[job.id];

            return (
              <div
                key={job.id}
                onClick={() => openJob(job)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJob(job); } }}
                className="w-full text-left px-4 py-3 hover:bg-accent/40 transition-colors space-y-1.5 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    isPaused ? "bg-violet-500"
                      : isPending ? "bg-blue-500"
                      : "bg-amber-500 animate-pulse"
                  )} />
                  <p className="text-sm font-medium text-foreground truncate flex-1">{job.title}</p>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{pct}%</span>
                </div>
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isPaused ? "bg-violet-500" : isPending ? "bg-blue-500" : "bg-amber-500"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-muted-foreground flex-1">
                    {job.processedCount} / {job.totalTasks} candidates
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    {isPaused ? (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); runAction(job.id, "resume"); }}
                        disabled={busy}
                        title="Resume"
                        className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); runAction(job.id, "pause"); }}
                        disabled={busy}
                        title="Pause"
                        className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        <Pause className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); runAction(job.id, "cancel"); }}
                      disabled={busy}
                      title="Cancel"
                      className="h-6 w-6 inline-flex items-center justify-center rounded-md border border-destructive/30 bg-background hover:bg-destructive/10 text-destructive disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

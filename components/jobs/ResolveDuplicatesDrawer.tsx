"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DuplicateTask {
  id: string;
  url: string;
  sourceFileName: string | null;
  status: string;
  createdAt: string;
  jobId: string;
  analysisResult: string | null;
}

export interface DuplicatePair {
  id: string;
  kind: "LINKEDIN_URL" | "RESUME_HASH";
  matchValue: string;
  createdAt: string;
  taskA: DuplicateTask;
  taskB: DuplicateTask;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pairs: DuplicatePair[];
  onResolved: () => void;
}

function parseScore(analysisResult: string | null): number | null {
  if (!analysisResult) return null;
  try {
    const parsed = JSON.parse(analysisResult);
    return typeof parsed.scorePercent === "number" ? parsed.scorePercent : null;
  } catch {
    return null;
  }
}

function parseName(task: DuplicateTask): string {
  if (task.analysisResult) {
    try {
      const parsed = JSON.parse(task.analysisResult);
      if (parsed.candidateName) return parsed.candidateName;
    } catch { /* ignore */ }
  }
  if (task.sourceFileName) return task.sourceFileName.replace(/\.pdf$/i, "");
  if (task.url.startsWith("resume://")) {
    return decodeURIComponent(task.url.replace("resume://", "")).replace(/\.pdf$/i, "");
  }
  const parts = task.url.split("/").filter(Boolean);
  return parts[parts.length - 1] || task.url;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground">Not scored</span>;
  const color = score >= 70 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : score >= 40 ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
    : "text-rose-400 bg-rose-500/10 border-rose-500/20";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", color)}>
      {Math.round(score)}%
    </span>
  );
}

function TaskCard({ task, label }: { task: DuplicateTask; label: string }) {
  const score = parseScore(task.analysisResult);
  const name = parseName(task);
  const jobShort = task.jobId.slice(-6).toUpperCase();
  const added = new Date(task.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const displayUrl = task.url.startsWith("resume://") ? (task.sourceFileName ?? task.url) : task.url;

  return (
    <div className="flex-1 min-w-0 space-y-1.5 p-3 rounded-lg bg-muted/30 border border-border">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <ScoreBadge score={score} />
      </div>
      <p className="text-sm font-semibold text-foreground truncate" title={name}>{name}</p>
      <p className="text-xs text-muted-foreground truncate" title={displayUrl}>{displayUrl}</p>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>Added {added}</span>
        <span>Run ···{jobShort}</span>
      </div>
    </div>
  );
}

function PairCard({
  pair,
  onAction,
  resolving,
}: {
  pair: DuplicatePair;
  onAction: (pairId: string, action: "DELETE_A" | "DELETE_B" | "KEEP_BOTH") => void;
  resolving: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="font-medium text-amber-500">
          {pair.kind === "LINKEDIN_URL" ? "Same LinkedIn URL" : "Same resume content"}
        </span>
      </div>

      <div className="flex gap-3">
        <TaskCard task={pair.taskA} label="Candidate A" />
        <div className="flex items-center justify-center shrink-0 text-muted-foreground text-xs font-mono select-none">≡</div>
        <TaskCard task={pair.taskB} label="Candidate B" />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={resolving}
          className="flex-1 text-xs"
          onClick={() => onAction(pair.id, "DELETE_B")}
        >
          Keep A, delete B
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={resolving}
          className="flex-1 text-xs"
          onClick={() => onAction(pair.id, "DELETE_A")}
        >
          Keep B, delete A
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={resolving}
          className="flex-1 text-xs text-muted-foreground"
          onClick={() => onAction(pair.id, "KEEP_BOTH")}
        >
          Not a duplicate
        </Button>
      </div>
    </div>
  );
}

export function ResolveDuplicatesDrawer({ open, onOpenChange, pairs: initialPairs, onResolved }: Props) {
  const [pairs, setPairs] = useState<DuplicatePair[]>(initialPairs);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Sync when parent updates the list
  if (JSON.stringify(initialPairs.map(p => p.id)) !== JSON.stringify(pairs.map(p => p.id)) && resolvingId === null) {
    setPairs(initialPairs);
  }

  async function handleAction(pairId: string, action: "DELETE_A" | "DELETE_B" | "KEEP_BOTH") {
    setResolvingId(pairId);
    // Optimistic removal
    setPairs((prev) => prev.filter((p) => p.id !== pairId));

    try {
      const res = await fetch(`/api/duplicates/${pairId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        // Roll back on failure
        setPairs(initialPairs);
      } else {
        onResolved();
      }
    } catch {
      setPairs(initialPairs);
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2">
            Duplicate Candidates
            {pairs.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {pairs.length} to resolve
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {pairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="text-sm font-medium">All duplicates resolved</p>
            </div>
          ) : (
            pairs.map((pair) => (
              <PairCard
                key={pair.id}
                pair={pair}
                onAction={handleAction}
                resolving={resolvingId === pair.id}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

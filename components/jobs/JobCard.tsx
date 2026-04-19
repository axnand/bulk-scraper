import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Users, Clock, PlayCircle } from "lucide-react";

export interface RequisitionSummary {
  id: string;
  title: string;
  department: string;
  runCount: number;
  totalCandidates: number;
  analyzedCount: number;
  activeRunStatus: string | null;
  activeRunProgress: { processed: number; total: number } | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

export function JobCard({
  requisition, viewMode, onClick,
}: {
  requisition: RequisitionSummary;
  viewMode: "grid" | "list";
  onClick: () => void;
}) {
  const r = requisition;
  const activeRun = r.activeRunStatus;
  const pct = r.activeRunProgress && r.activeRunProgress.total > 0
    ? Math.round((r.activeRunProgress.processed / r.activeRunProgress.total) * 100)
    : 0;

  if (viewMode === "list") {
    return (
      <Card
        className="cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all"
        onClick={onClick}
      >
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate">{r.title}</p>
            {r.department && <p className="text-xs text-muted-foreground truncate mt-0.5">{r.department}</p>}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Users className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{r.totalCandidates}</span>
            <span>candidates</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <PlayCircle className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{r.runCount}</span>
            <span>run{r.runCount !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
            <Clock className="h-3.5 w-3.5" />
            <span>Updated {timeAgo(r.updatedAt)}</span>
          </div>
          {activeRun && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400 shrink-0">
              {activeRun === "PROCESSING" ? "Running…" : "Queued"}
            </span>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="cursor-pointer hover:border-primary/40 hover:shadow-md transition-all group h-full"
      onClick={onClick}
    >
      <CardContent className="p-5 flex flex-col h-full gap-3">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-base text-foreground leading-snug line-clamp-2 flex-1 group-hover:text-primary transition-colors">
            {r.title}
          </p>
        </div>

        {r.department && (
          <p className="text-xs text-muted-foreground -mt-1.5">{r.department}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{r.totalCandidates}</span>
            <span>candidates</span>
          </div>
          <div className="flex items-center gap-1.5">
            <PlayCircle className="h-3.5 w-3.5" />
            <span className="font-medium text-foreground">{r.runCount}</span>
            <span>run{r.runCount !== 1 ? "s" : ""}</span>
          </div>
        </div>

        {activeRun && r.activeRunProgress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold">
              <span className="text-amber-600 dark:text-amber-400">
                {activeRun === "PROCESSING" ? "Running" : "Queued"}
              </span>
              <span className="font-mono text-muted-foreground">{pct}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider font-semibold">
            <span className="text-emerald-600 dark:text-emerald-400">
              {r.analyzedCount} <span className="font-medium opacity-70">analyzed</span>
            </span>
          </div>
          <span className={cn(
            "flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold",
            "text-muted-foreground"
          )}>
            <Clock className="h-3 w-3" />
            Updated {timeAgo(r.updatedAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useMemo } from "react";
import { FileText, Users, TrendingUp, Minus, TrendingDown, Award, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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

interface Props {
  data: JobResults;
}

const DEFAULT_SCORING_RULES: Record<string, boolean> = {
  stability: true, growth: true, graduation: true, companyType: true,
  mba: true, skillMatch: true, location: true,
};

const BUILT_IN_LABELS: Record<string, string> = {
  stability: "Stability",
  growth: "Growth",
  graduation: "Graduation",
  companyType: "Company Type",
  mba: "MBA",
  skillMatch: "Skill Match",
  location: "Location",
};

function timeAgo(iso: string | Date | undefined | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function DashboardTab({ data }: Props) {
  const cfg = data.config || {};
  const jd = cfg.jobDescription || "";

  const stats = useMemo(() => {
    let strong = 0, moderate = 0, notFit = 0, scoreSum = 0, scoreCount = 0;
    let pending = 0, processing = 0, done = 0, failed = 0;
    let lastDone: { name: string; at: Date } | null = null;

    for (const t of data.tasks) {
      if (t.status === "PENDING") pending++;
      else if (t.status === "PROCESSING") processing++;
      else if (t.status === "DONE") done++;
      else if (t.status === "FAILED") failed++;

      if (t.analysisResult) {
        const a = t.analysisResult;
        if (a.recommendation === "Strong Fit") strong++;
        else if (a.recommendation === "Moderate Fit") moderate++;
        else if (a.recommendation === "Not a Fit") notFit++;

        if (typeof a.scorePercent === "number") {
          scoreSum += a.scorePercent;
          scoreCount++;
        }
        const name = a.candidateInfo?.name;
        if (name && t.status === "DONE") {
          const at = new Date((t as any).updatedAt || Date.now());
          if (!lastDone || at > lastDone.at) lastDone = { name, at };
        }
      }
    }
    const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

    return { strong, moderate, notFit, avgScore, pending, processing, done, failed, lastDone };
  }, [data.tasks]);

  const total = data.totalTasks || 0;
  // Fall back to all-enabled defaults if scoringRules hasn't been saved yet
  const rawRules = cfg.scoringRules || {};
  const enabledRules = Object.keys(rawRules).length > 0 ? rawRules : DEFAULT_SCORING_RULES;
  const enabledLabels = Object.entries(enabledRules)
    .filter(([, v]) => v)
    .map(([k]) => BUILT_IN_LABELS[k] || k);
  const customCount = (cfg.customScoringRules || []).filter((r: any) => r.enabled).length;

  const statusBars = [
    { key: "done",       label: "Done",       count: stats.done,       color: "bg-emerald-500" },
    { key: "processing", label: "Processing", count: stats.processing, color: "bg-amber-500" },
    { key: "pending",    label: "Pending",    count: stats.pending,    color: "bg-blue-500" },
    { key: "failed",     label: "Failed",     count: stats.failed,     color: "bg-rose-500" },
  ];
  const statusTotal = stats.done + stats.processing + stats.pending + stats.failed || 1;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">
      {/* Left — JD preview */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Job Description
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jd ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">{jd}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">No job description set yet.</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Open the Settings tab to add one.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right column — KPIs */}
      <div className="space-y-4">
        {/* 4-up stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Total" value={total} icon={Users} tone="neutral" />
          <StatTile label="Strong Fit" value={stats.strong} icon={TrendingUp} tone="emerald" />
          <StatTile label="Moderate" value={stats.moderate} icon={Minus} tone="amber" />
          <StatTile label="Not a Fit" value={stats.notFit} icon={TrendingDown} tone="rose" />
        </div>

        {/* Average score */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Award className="h-3.5 w-3.5" />
              <span className="uppercase tracking-wider font-medium">Average Score</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-foreground">{stats.avgScore}</span>
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  stats.avgScore >= 70 ? "bg-emerald-500" : stats.avgScore >= 40 ? "bg-amber-500" : "bg-rose-500"
                )}
                style={{ width: `${stats.avgScore}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Pipeline breakdown */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Pipeline</p>
            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
              {statusBars.map(s => s.count > 0 && (
                <div key={s.key} className={s.color} style={{ width: `${(s.count / statusTotal) * 100}%` }} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {statusBars.map(s => (
                <div key={s.key} className="flex items-center gap-2 text-xs">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", s.color)} />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="ml-auto font-mono text-foreground">{s.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Scoring rules summary */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider font-medium text-muted-foreground">Scoring Rules</p>
            {enabledLabels.length > 0 ? (
              <p className="text-xs text-foreground leading-relaxed">{enabledLabels.join(" · ")}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">No built-in rules enabled.</p>
            )}
            {customCount > 0 && (
              <p className="text-[11px] text-muted-foreground">+ {customCount} custom rule{customCount !== 1 ? "s" : ""}</p>
            )}
          </CardContent>
        </Card>

        {/* Last processed */}
        {stats.lastDone && (
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Last processed</p>
                <p className="text-sm text-foreground truncate">{stats.lastDone.name}</p>
                <p className="text-[11px] text-muted-foreground">{timeAgo(stats.lastDone.at)}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label, value, icon: Icon, tone,
}: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>; tone: "neutral" | "emerald" | "amber" | "rose";
}) {
  const tones: Record<string, string> = {
    neutral: "text-foreground",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber:   "text-amber-600 dark:text-amber-400",
    rose:    "text-rose-600 dark:text-rose-400",
  };
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium text-muted-foreground">
          <Icon className="h-3 w-3" />
          {label}
        </div>
        <p className={cn("text-2xl font-bold mt-1", tones[tone])}>{value}</p>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight, ExternalLink, Briefcase, Building2, MapPin,
  GraduationCap, FileText, Send, Loader2, MessageSquare,
  ArrowRightLeft, Calendar, TrendingUp, Award, AlertCircle, CheckCircle2,
  XCircle, ChevronLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { estimateCost, formatCost } from "@/lib/model-pricing";
import { getEffectiveRules } from "@/lib/analyzer";
import { cn } from "@/lib/utils";
import { STAGE_CONFIG } from "@/components/outreach/stage-config";

interface StageEvent {
  id: string;
  fromStage: string | null;
  toStage: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}

interface OutreachMsg {
  id: string;
  channel: string;
  status: string;
  direction: string;
  renderedBody: string;
  inboundBody: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface Note {
  id: string;
  body: string;
  authorEmail: string;
  createdAt: string;
}

interface TaskDetail {
  id: string;
  url: string;
  source: string;
  sourceFileName: string | null;
  hasResume: boolean;
  status: string;
  stage: string;
  createdAt: string;
  result: any;
  analysisResult: any;
  errorMessage: string | null;
  stageEvents: StageEvent[];
  outreachMessages: OutreachMsg[];
  job: {
    id: string;
    title: string;
    requisitionId: string | null;
    requisitionTitle: string;
    config: any;
  };
}

function getInitials(name: string) {
  return name.split(" ").slice(0, 2).map(n => n[0] ?? "").join("").toUpperCase();
}

export default function CandidateDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.error)))
      .then(setTask)
      .catch(e => setError(typeof e === "string" ? e : "Failed to load candidate"))
      .finally(() => setLoading(false));
    fetch(`/api/tasks/${taskId}/notes`)
      .then(r => r.json())
      .then(d => setNotes(d.notes ?? []))
      .catch(() => {});
  }, [taskId]);

  async function saveNote() {
    if (!noteInput.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteInput }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setNotes(prev => [d.note, ...prev]);
      setNoteInput("");
    } catch { /* ignore */ } finally {
      setSavingNote(false);
    }
  }

  if (loading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="space-y-4 w-full max-w-lg px-8 animate-pulse">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-8 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-2/3" />
          <div className="h-48 bg-muted rounded mt-6" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">{error || "Candidate not found"}</p>
          <button onClick={() => window.close()} className="text-xs text-primary hover:underline">Close tab</button>
        </div>
      </div>
    );
  }

  const profile = task.result;
  const analysis = task.analysisResult;
  const jobConfig = task.job.config || {};

  const scrapedName = profile ? [profile.first_name, profile.last_name].filter(Boolean).join(" ") : "";
  const extracted = profile?.extractedInfo || {};
  const name = scrapedName || extracted.name || analysis?.candidateInfo?.name || "Unknown";
  const headline = profile?.headline || profile?.occupation || extracted.currentDesignation || "";
  const location = analysis?.candidateInfo?.currentLocation || profile?.location || extracted.currentLocation || "";
  const info = analysis?.candidateInfo;

  const scorePercent = analysis?.scorePercent ?? 0;
  const scoreColor = scorePercent >= 70 ? "text-emerald-500" : scorePercent >= 40 ? "text-amber-500" : "text-rose-500";
  const scoreBgClass = scorePercent >= 70 ? "bg-emerald-500" : scorePercent >= 40 ? "bg-amber-500" : "bg-rose-500";
  const recommendationStyle =
    analysis?.recommendation === "Strong Fit"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
      : analysis?.recommendation === "Moderate Fit"
      ? "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400"
      : "bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400";

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top Nav Bar */}
      <header className="shrink-0 bg-background/95 backdrop-blur border-b border-border z-20">
        <div className="flex items-center justify-between px-6 h-12">
          <div className="flex items-center gap-2 text-sm">
            {task.job.requisitionId ? (
              <Link
                href={`/jobs/${task.job.requisitionId}`}
                className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                {task.job.requisitionTitle}
              </Link>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <ChevronLeft className="h-4 w-4" />
                {task.job.requisitionTitle}
              </span>
            )}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="font-semibold text-foreground">{name}</span>
          </div>
          <div className="flex items-center gap-2">
            {task.hasResume && (
              <a
                href={`/api/tasks/${task.id}/resume`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20"
              >
                <FileText className="h-3.5 w-3.5" />
                View Resume
              </a>
            )}
            {task.url && (
              <a
                href={task.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md border border-border hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Hero strip */}
      <div className="shrink-0 border-b border-border bg-card px-6 py-5">
        <div className="flex items-center gap-5">
          <Avatar className="h-16 w-16 shrink-0 ring-2 ring-border">
            <AvatarImage
              src={profile?.profile_picture_url
                ? `/api/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`
                : undefined}
              alt={name}
            />
            <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-foreground tracking-tight">{name}</h1>
              {analysis?.recommendation && (
                <Badge variant="outline" className={cn("text-xs font-semibold px-2.5 py-0.5", recommendationStyle)}>
                  {analysis.recommendation}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{info?.currentDesignation || headline}</p>
            <div className="flex items-center gap-5 mt-2 text-xs text-muted-foreground flex-wrap">
              {info?.currentOrg && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  {info.currentOrg}
                </span>
              )}
              {location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {location}
                </span>
              )}
              {info?.totalExperienceYears > 0 && (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 shrink-0" />
                  {info.totalExperienceYears} yrs experience
                </span>
              )}
              {info?.stabilityAvgYears > 0 && (
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  {info.stabilityAvgYears} yrs avg tenure
                </span>
              )}
            </div>
          </div>

          {analysis && (
            <div className="shrink-0 flex items-center gap-4 pl-4 border-l border-border">
              <div className="text-right">
                <p className={cn("text-4xl font-black tabular-nums leading-none", scoreColor)}>
                  {scorePercent}%
                </p>
                <p className="text-xs text-muted-foreground mt-1 font-medium">
                  {analysis.totalScore} / {analysis.maxScore} pts
                </p>
              </div>
              <div className="relative h-14 w-14">
                <svg className="h-14 w-14 -rotate-90" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/40" />
                  <circle
                    cx="18" cy="18" r="15.9" fill="none" strokeWidth="2.5"
                    strokeDasharray={`${scorePercent} ${100 - scorePercent}`}
                    strokeLinecap="round"
                    className={scorePercent >= 70 ? "stroke-emerald-500" : scorePercent >= 40 ? "stroke-amber-500" : "stroke-rose-500"}
                  />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main content — 3-column scrollable */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-1 xl:grid-cols-[280px_1fr_300px] divide-x divide-border">

          {/* LEFT PANEL — Profile meta */}
          <aside className="overflow-y-auto p-5 space-y-6">

            {/* Quick stats */}
            {info && (
              <section>
                <SectionLabel>Profile Info</SectionLabel>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {info.totalExperienceYears > 0 && (
                    <StatCard label="Experience" value={`${info.totalExperienceYears} yrs`} />
                  )}
                  {info.companiesSwitched > 0 && (
                    <StatCard label="Companies" value={String(info.companiesSwitched)} />
                  )}
                  {info.stabilityAvgYears > 0 && (
                    <StatCard label="Avg Tenure" value={`${info.stabilityAvgYears} yrs`} />
                  )}
                  {info.currentLocation && (
                    <StatCard label="Location" value={info.currentLocation} span />
                  )}
                  {info.btech && (
                    <StatCard label="BTech / BE" value={info.btech} span />
                  )}
                  {info.graduation && (
                    <StatCard label="Graduation" value={info.graduation} span />
                  )}
                  {info.mba && (
                    <StatCard label="MBA" value={info.mba} span />
                  )}
                  {info.graduationYear && (
                    <StatCard label="Grad Year" value={String(info.graduationYear)} />
                  )}
                </div>
              </section>
            )}

            {/* Strengths */}
            {analysis?.strengths?.length > 0 && (
              <section>
                <SectionLabel icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}>
                  Strengths
                </SectionLabel>
                <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
                  {analysis.strengths.map((s: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                      <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>
                      <span className="leading-relaxed">{s}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Gaps */}
            {analysis?.gaps?.length > 0 && (
              <section>
                <SectionLabel icon={<AlertCircle className="h-3.5 w-3.5 text-amber-500" />}>
                  Gaps
                </SectionLabel>
                <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                  {analysis.gaps.map((g: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                      <span className="text-amber-500 mt-0.5 shrink-0">△</span>
                      <span className="leading-relaxed">{g}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Flags */}
            {analysis?.flags?.length > 0 && (
              <section>
                <SectionLabel icon={<XCircle className="h-3.5 w-3.5 text-rose-500" />}>
                  Red Flags
                </SectionLabel>
                <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 space-y-2">
                  {analysis.flags.map((f: string, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                      <span className="text-rose-500 mt-0.5 shrink-0">✕</span>
                      <span className="leading-relaxed">{f}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </aside>

          {/* CENTER PANEL — Main content */}
          <main className="overflow-y-auto p-6 space-y-6">

            {/* AI Summary */}
            {analysis?.experienceSummary && (
              <section>
                <SectionLabel icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}>
                  AI Summary
                </SectionLabel>
                <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <p className="text-sm text-foreground leading-relaxed">{analysis.experienceSummary}</p>
                  {analysis.remarks && (
                    <p className="text-sm text-muted-foreground italic border-t border-primary/10 pt-3">{analysis.remarks}</p>
                  )}
                </div>
              </section>
            )}

            {/* Scoring breakdown */}
            {analysis && (
              <section>
                <SectionLabel icon={<Award className="h-3.5 w-3.5 text-primary" />}>
                  Scoring Breakdown
                </SectionLabel>
                <div className="mt-3 rounded-xl border border-border bg-card overflow-hidden">
                  {(() => {
                    const effectiveRules = getEffectiveRules({
                      scoringRules: analysis.enabledRules || jobConfig.scoringRules,
                      customScoringRules: analysis.customScoringRules || jobConfig.customScoringRules || [],
                      builtInRuleDescriptions: jobConfig.builtInRuleDescriptions,
                      ruleDefinitions: jobConfig.ruleDefinitions,
                    }).filter((r: any) => r.enabled);

                    return effectiveRules.map((rule: any, idx: number) => {
                      const ruleMax = Math.max(0, ...rule.scoreParameters.map((p: any) => p.maxPoints));
                      const val = (rule.scoreParameters as any[]).reduce<number>((best: number, p: any) => {
                        const s = analysis.scoring?.[p.key];
                        return typeof s === "number" && s > best ? s : best;
                      }, 0);
                      const logText = analysis.scoringLogs?.[rule.key];
                      const pct = ruleMax > 0 ? (val / ruleMax) * 100 : 0;
                      const barColor = val >= ruleMax * 0.7 ? "bg-emerald-500" : val > 0 ? "bg-amber-500" : "bg-muted-foreground/20";

                      return (
                        <div
                          key={rule.key}
                          className={cn("px-5 py-3.5", idx > 0 && "border-t border-border/60")}
                        >
                          <div className="flex items-center gap-4">
                            <span className="text-sm text-muted-foreground w-36 shrink-0 font-medium">{rule.label}</span>
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={cn(
                              "text-sm font-bold tabular-nums w-16 text-right shrink-0",
                              val >= ruleMax * 0.7 ? "text-emerald-500" : val > 0 ? "text-amber-500" : "text-muted-foreground"
                            )}>
                              {val}/{ruleMax}
                            </span>
                          </div>
                          {logText && (
                            <p className="text-xs text-muted-foreground mt-1.5 pl-40 leading-relaxed">{logText}</p>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </section>
            )}

            {/* Skills */}
            {analysis?.skillBreakdown && (
              <section>
                <SectionLabel>
                  Skills &mdash; {analysis.skillBreakdown.matchPercent}% Match
                </SectionLabel>
                <div className="mt-3 rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap gap-2">
                    {(analysis.skillBreakdown.matchedSkills || []).map((s: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 font-medium">{s}</span>
                    ))}
                    {(analysis.skillBreakdown.missingSkills || []).map((s: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25 font-medium">{s}</span>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-3 pt-3 border-t border-border/60">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> Matched
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-rose-500 inline-block" /> Missing
                    </span>
                  </div>
                </div>
              </section>
            )}

            {/* Work Experience */}
            {profile?.work_experience?.length > 0 && (
              <section>
                <SectionLabel icon={<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />}>
                  Work Experience
                </SectionLabel>
                <div className="mt-3 space-y-3">
                  {profile.work_experience.map((exp: any, i: number) => (
                    <div key={i} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">{exp.position || "Untitled Role"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{exp.company || ""}</p>
                        </div>
                        {exp.start && (
                          <span className="text-xs text-muted-foreground/70 shrink-0 bg-muted/60 px-2 py-0.5 rounded-md">
                            {exp.start} – {exp.end || "Present"}
                          </span>
                        )}
                      </div>
                      {exp.description && (
                        <p className="text-xs text-muted-foreground mt-2.5 leading-relaxed line-clamp-3">{exp.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Education */}
            {profile?.education?.length > 0 && (
              <section>
                <SectionLabel icon={<GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />}>
                  Education
                </SectionLabel>
                <div className="mt-3 space-y-2">
                  {profile.education.map((edu: any, i: number) => (
                    <div key={i} className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
                      <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{edu.school || "Unknown School"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{[edu.degree, edu.field_of_study].filter(Boolean).join(" · ")}</p>
                        {(edu.start_year || edu.end_year) && (
                          <p className="text-xs text-muted-foreground/60 mt-0.5">{edu.start_year} – {edu.end_year || "Present"}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* About */}
            {profile?.summary && (
              <section>
                <SectionLabel>About</SectionLabel>
                <div className="mt-3 rounded-xl border border-border bg-card p-4">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{profile.summary}</p>
                </div>
              </section>
            )}

            {/* Debug */}
            {analysis?.__debug && (
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1.5 select-none">
                  <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                  Debug Info
                </summary>
                <div className="mt-3 space-y-2 pl-4">
                  <div className="bg-muted/40 rounded-lg p-3">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase mb-1">Model</p>
                    <p className="text-xs font-mono text-muted-foreground">{analysis.__debug.model}</p>
                  </div>
                  {analysis.__debug.usage && (() => {
                    const usage = analysis.__debug.usage;
                    const cost = estimateCost(usage.prompt_tokens, usage.completion_tokens, analysis.__debug.model);
                    return (
                      <div className="bg-muted/40 rounded-lg p-3">
                        <p className="text-[10px] text-muted-foreground font-medium uppercase mb-1">Token Usage</p>
                        <p className="text-xs font-mono text-muted-foreground">
                          Prompt: {usage.prompt_tokens} · Completion: {usage.completion_tokens} · Total: {usage.total_tokens}
                        </p>
                        {cost && <p className="text-xs font-mono text-emerald-400/80 mt-1">Cost: {formatCost(cost.totalCost)}</p>}
                      </div>
                    );
                  })()}
                </div>
              </details>
            )}
          </main>

          {/* RIGHT PANEL — Notes + Activity */}
          <aside className="overflow-y-auto p-5 space-y-6">

            {/* Notes */}
            <section>
              <SectionLabel icon={<MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />}>
                Notes
              </SectionLabel>
              <div className="mt-3 space-y-2">
                <Textarea
                  value={noteInput}
                  onChange={e => setNoteInput(e.target.value)}
                  placeholder="Add a note about this candidate…"
                  rows={4}
                  className="text-sm resize-none bg-muted/30 border-border/60 focus:bg-background"
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote();
                  }}
                />
                <Button
                  size="sm"
                  className="w-full gap-1.5 text-xs h-8"
                  disabled={savingNote || !noteInput.trim()}
                  onClick={saveNote}
                >
                  {savingNote ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
                  Save note
                </Button>

                {notes.length > 0 && (
                  <div className="space-y-2 pt-2">
                    {notes.map(n => (
                      <div key={n.id} className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
                        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground/70">
                          {n.authorEmail || "Reviewer"} · {new Date(n.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Activity */}
            {((task.stageEvents?.length ?? 0) + (task.outreachMessages?.filter(m => m.status === "SENT" || m.direction === "IN")?.length ?? 0)) > 0 && (
              <section>
                <SectionLabel>Activity</SectionLabel>
                <ol className="mt-3 relative border-l-2 border-border/50 space-y-4 pl-5">
                  {buildTimeline(task.stageEvents ?? [], task.outreachMessages ?? []).map((item, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[1.4rem] top-1 h-4 w-4 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                        {item.type === "stage"
                          ? <ArrowRightLeft className="h-2 w-2 text-muted-foreground" />
                          : <Send className="h-2 w-2 text-muted-foreground" />}
                      </span>
                      <p className="text-xs font-semibold text-foreground leading-snug">{item.label}</p>
                      {item.sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.sub}</p>}
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">{item.time}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{children}</p>
    </div>
  );
}

function StatCard({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={cn("bg-muted/40 rounded-lg p-2.5", span && "col-span-2")}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-foreground leading-snug">{value}</p>
    </div>
  );
}

function buildTimeline(
  stageEvents: StageEvent[],
  outreachMessages: OutreachMsg[],
): { type: "stage" | "message"; label: string; sub?: string; time: string }[] {
  const items: { type: "stage" | "message"; label: string; sub?: string; time: string; ts: number }[] = [];

  for (const ev of stageEvents) {
    const from = ev.fromStage ? (STAGE_CONFIG as any)[ev.fromStage]?.label ?? ev.fromStage : null;
    const to = (STAGE_CONFIG as any)[ev.toStage]?.label ?? ev.toStage;
    items.push({
      type: "stage",
      label: from ? `${from} → ${to}` : `Moved to ${to}`,
      sub: ev.reason ?? ev.actor,
      time: fmtTime(ev.createdAt),
      ts: new Date(ev.createdAt).getTime(),
    });
  }

  for (const msg of outreachMessages) {
    if (msg.direction === "IN") {
      items.push({
        type: "message",
        label: "Reply received",
        sub: msg.inboundBody ? msg.inboundBody.slice(0, 80) + (msg.inboundBody.length > 80 ? "…" : "") : undefined,
        time: fmtTime(msg.sentAt ?? msg.createdAt),
        ts: new Date(msg.sentAt ?? msg.createdAt).getTime(),
      });
    } else if (msg.status === "SENT") {
      const channel = msg.channel === "LINKEDIN_INVITE" ? "Invite sent" : "Message sent";
      items.push({
        type: "message",
        label: channel,
        sub: msg.renderedBody ? msg.renderedBody.slice(0, 60) + (msg.renderedBody.length > 60 ? "…" : "") : undefined,
        time: fmtTime(msg.sentAt ?? msg.createdAt),
        ts: new Date(msg.sentAt ?? msg.createdAt).getTime(),
      });
    }
  }

  return items.sort((a, b) => b.ts - a.ts).map(({ ts: _, ...rest }) => rest);
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

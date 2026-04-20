"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight, ExternalLink, Briefcase, Building2, MapPin,
  GraduationCap, Users, Clock, TrendingUp, FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { estimateCost, formatCost } from "@/lib/model-pricing";
import { getEffectiveRules } from "@/lib/analyzer";
import { cn } from "@/lib/utils";

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

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 rounded-lg p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

export default function CandidateDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}`)
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e.error)))
      .then(setTask)
      .catch(e => setError(typeof e === "string" ? e : "Failed to load candidate"))
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-3 w-full max-w-xl px-8 animate-pulse">
          <div className="h-5 bg-muted rounded w-1/3" />
          <div className="h-10 bg-muted rounded w-1/2" />
          <div className="h-4 bg-muted rounded w-2/3" />
          <div className="h-64 bg-muted rounded mt-8" />
        </div>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
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

  const scoreColor =
    analysis?.scorePercent >= 70 ? "text-emerald-500" :
    analysis?.scorePercent >= 40 ? "text-amber-500" : "text-rose-500";

  const scoreBg =
    analysis?.recommendation === "Strong Fit" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" :
    analysis?.recommendation === "Moderate Fit" ? "bg-amber-500/10 text-amber-500 border-amber-500/30" :
    "bg-rose-500/10 text-rose-500 border-rose-500/30";

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-8 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {task.job.requisitionId ? (
              <Link href={`/jobs/${task.job.requisitionId}`} className="hover:text-foreground transition-colors">
                {task.job.requisitionTitle}
              </Link>
            ) : (
              <span>{task.job.requisitionTitle}</span>
            )}
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium">{name}</span>
          </div>
          <div className="flex items-center gap-2">
            {task.hasResume && (
              <a
                href={`/api/tasks/${task.id}/resume`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20"
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
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {/* Hero */}
        <div className="flex items-start gap-6 flex-wrap">
          <Avatar className="h-20 w-20 shrink-0">
            <AvatarImage
              src={profile?.profile_picture_url
                ? `/api/proxy-image?url=${encodeURIComponent(profile.profile_picture_url)}`
                : undefined}
              alt={name}
            />
            <AvatarFallback className="text-2xl font-bold bg-linear-to-br from-violet-500 to-indigo-600 text-white">
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{name}</h1>
              {analysis?.recommendation && (
                <Badge variant="outline" className={cn("text-xs font-semibold mt-0.5", scoreBg)}>
                  {analysis.recommendation}
                </Badge>
              )}
            </div>
            <p className="text-base text-muted-foreground">{info?.currentDesignation || headline}</p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              {info?.currentOrg && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> {info.currentOrg}
                </span>
              )}
              {location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> {location}
                </span>
              )}
              {info?.totalExperienceYears > 0 && (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5" /> {info.totalExperienceYears} yrs experience
                </span>
              )}
            </div>
          </div>

          {analysis && (
            <div className="shrink-0 text-right">
              <p className={cn("text-4xl font-bold tabular-nums", scoreColor)}>{analysis.scorePercent}%</p>
              <p className="text-xs text-muted-foreground mt-1">{analysis.totalScore} / {analysis.maxScore} pts</p>
              <div className="mt-2 h-2 w-32 bg-muted rounded-full overflow-hidden ml-auto">
                <div
                  className={cn("h-full rounded-full", analysis.scorePercent >= 70 ? "bg-emerald-500" : analysis.scorePercent >= 40 ? "bg-amber-500" : "bg-rose-500")}
                  style={{ width: `${(analysis.totalScore / analysis.maxScore) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column */}
          <div className="lg:col-span-1 space-y-6">
            {/* Candidate info */}
            {info && (
              <Section title="Profile Info">
                <div className="grid grid-cols-2 gap-2">
                  {info.totalExperienceYears > 0 && <InfoField label="Experience" value={`${info.totalExperienceYears} yrs`} />}
                  {info.companiesSwitched > 0 && <InfoField label="Companies" value={String(info.companiesSwitched)} />}
                  {info.stabilityAvgYears > 0 && <InfoField label="Avg Tenure" value={`${info.stabilityAvgYears} yrs`} />}
                  {info.currentLocation && <InfoField label="Location" value={info.currentLocation} />}
                  {info.btech && <InfoField label="BTech/BE" value={info.btech} />}
                  {info.graduation && <InfoField label="Graduation" value={info.graduation} />}
                  {info.mba && <InfoField label="MBA" value={info.mba} />}
                  {info.graduationYear && <InfoField label="Grad Year" value={String(info.graduationYear)} />}
                </div>
              </Section>
            )}

            {/* Strengths */}
            {analysis?.strengths?.length > 0 && (
              <Section title="Strengths">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                  <ul className="space-y-2">
                    {analysis.strengths.map((s: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <span className="text-emerald-500 mt-0.5">✓</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </Section>
            )}

            {/* Gaps */}
            {analysis?.gaps?.length > 0 && (
              <Section title="Gaps">
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <ul className="space-y-2">
                    {analysis.gaps.map((g: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <span className="text-amber-500 mt-0.5">△</span> {g}
                      </li>
                    ))}
                  </ul>
                </div>
              </Section>
            )}

            {/* Flags */}
            {analysis?.flags?.length > 0 && (
              <Section title="Red Flags">
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                  <ul className="space-y-2">
                    {analysis.flags.map((f: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                        <span className="text-rose-500 mt-0.5">✕</span> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Section>
            )}
          </div>

          {/* Right column */}
          <div className="lg:col-span-2 space-y-6">
            {/* AI Summary */}
            {analysis?.experienceSummary && (
              <Section title="AI Summary">
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 space-y-2">
                  <p className="text-sm text-foreground leading-relaxed">{analysis.experienceSummary}</p>
                  {analysis.remarks && (
                    <p className="text-sm text-muted-foreground italic">{analysis.remarks}</p>
                  )}
                </div>
              </Section>
            )}

            {/* Scoring breakdown */}
            {analysis && (
              <Section title="Scoring Breakdown">
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="divide-y divide-border/60">
                    {(() => {
                      const effectiveRules = getEffectiveRules({
                        scoringRules: analysis.enabledRules || jobConfig.scoringRules,
                        customScoringRules: analysis.customScoringRules || jobConfig.customScoringRules || [],
                        builtInRuleDescriptions: jobConfig.builtInRuleDescriptions,
                        ruleDefinitions: jobConfig.ruleDefinitions,
                      }).filter(r => r.enabled);

                      return effectiveRules.map(rule => {
                        const ruleMax = Math.max(0, ...rule.scoreParameters.map((p: any) => p.maxPoints));
                        const val = rule.scoreParameters.reduce<number>((best: number, p: any) => {
                          const s = analysis.scoring?.[p.key];
                          return typeof s === "number" && s > best ? s : best;
                        }, 0);
                        const logText = analysis.scoringLogs?.[rule.key];
                        return (
                          <div key={rule.key} className="px-4 py-3 space-y-2">
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-muted-foreground w-40 shrink-0">{rule.label}</span>
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full", val >= ruleMax * 0.7 ? "bg-emerald-500" : val > 0 ? "bg-amber-500" : "bg-muted-foreground/30")}
                                  style={{ width: `${ruleMax > 0 ? (val / ruleMax) * 100 : 0}%` }}
                                />
                              </div>
                              <span className="text-sm font-mono text-foreground w-14 text-right shrink-0">
                                {val}/{ruleMax}
                              </span>
                            </div>
                            {logText && (
                              <p className="text-xs text-muted-foreground pl-[10.5rem] leading-relaxed">{logText}</p>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </Section>
            )}

            {/* Skill match */}
            {analysis?.skillBreakdown && (
              <Section title={`Skills — ${analysis.skillBreakdown.matchPercent}% Match`}>
                <div className="bg-card border border-border rounded-xl p-4">
                  <div className="flex flex-wrap gap-2">
                    {(analysis.skillBreakdown.matchedSkills || []).map((s: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-medium">{s}</span>
                    ))}
                    {(analysis.skillBreakdown.missingSkills || []).map((s: string, i: number) => (
                      <span key={i} className="px-2.5 py-1 rounded-full text-xs bg-rose-500/15 text-rose-500 border border-rose-500/30 font-medium">{s}</span>
                    ))}
                  </div>
                </div>
              </Section>
            )}

            {/* Work experience */}
            {profile?.work_experience?.length > 0 && (
              <Section title="Work Experience">
                <div className="space-y-2">
                  {profile.work_experience.map((exp: any, i: number) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{exp.position || "Untitled Role"}</p>
                          <p className="text-sm text-muted-foreground">{exp.company || ""}</p>
                        </div>
                        {exp.start && (
                          <span className="text-xs text-muted-foreground/70 shrink-0">
                            {exp.start} – {exp.end || "Present"}
                          </span>
                        )}
                      </div>
                      {exp.description && (
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-3">{exp.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Education */}
            {profile?.education?.length > 0 && (
              <Section title="Education">
                <div className="space-y-2">
                  {profile.education.map((edu: any, i: number) => (
                    <div key={i} className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
                      <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{edu.school || "Unknown School"}</p>
                        <p className="text-xs text-muted-foreground">{[edu.degree, edu.field_of_study].filter(Boolean).join(" · ")}</p>
                        {(edu.start_year || edu.end_year) && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5">{edu.start_year} – {edu.end_year || "Present"}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* About */}
            {profile?.summary && (
              <Section title="About">
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{profile.summary}</p>
                </div>
              </Section>
            )}

            {/* Debug (collapsed) */}
            {analysis?.__debug && (
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground list-none flex items-center gap-1.5">
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
          </div>
        </div>
      </div>
    </div>
  );
}

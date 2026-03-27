"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

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
  tasks: TaskResult[];
}

export default function JobResultsPage() {
  const params = useParams();
  const jobId = params.jobId as string;
  const [data, setData] = useState<JobResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    async function fetchResults() {
      try {
        const res = await fetch(`/api/jobs/${jobId}/results`);
        if (!res.ok) throw new Error("Failed to fetch results");
        const json = await res.json();
        setData(json);

        // Keep polling if still processing
        if (json.status === "PROCESSING" || json.status === "PENDING") {
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

    fetchResults();
    interval = setInterval(fetchResults, 3000);
    return () => clearInterval(interval);
  }, [jobId]);

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
    CANCELLED: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
    DONE: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  };

  const completedTasks = data.tasks.filter((t) => t.status === "DONE");
  const failedTasks = data.tasks.filter((t) => t.status === "FAILED");
  const pendingTasks = data.tasks.filter((t) => t.status === "PENDING" || t.status === "PROCESSING");

  return (
    <main className="space-y-6">
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
          <h2 className="text-lg font-semibold text-white">
            Scraped Profiles ({completedTasks.length})
          </h2>
          <div className="space-y-3">
            {completedTasks.map((task) => (
              <ProfileCard
                key={task.id}
                task={task}
                expanded={expandedTask === task.id}
                onToggle={() =>
                  setExpandedTask(expandedTask === task.id ? null : task.id)
                }
              />
            ))}
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
        {/* Avatar placeholder */}
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold text-lg shrink-0">
          {(profile.first_name || "?")[0]}
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
                    { label: 'Stability', key: 'stability', max: 10 },
                    { label: 'Growth (Same Co)', key: 'promotionSameCompany', max: 15 },
                    { label: 'Growth (Change)', key: 'promotionWithChange', max: 10 },
                    { label: 'Graduation Tier 1', key: 'gradTier1', max: 15 },
                    { label: 'Graduation Tier 2', key: 'gradTier2', max: 10 },
                    { label: 'Sales/CRM', key: 'salesCRM', max: 15 },
                    { label: 'Other B2B', key: 'otherB2B', max: 10 },
                    { label: 'MBA A', key: 'mbaA', max: 15 },
                    { label: 'MBA Others', key: 'mbaOthers', max: 10 },
                    { label: 'Skillset Match', key: 'skillsetMatch', max: 10 },
                    { label: 'Location', key: 'locationMatch', max: 5 },
                  ].filter(d => analysis.scoring[d.key] !== '' && analysis.scoring[d.key] !== undefined).map(dim => {
                    const val = typeof analysis.scoring[dim.key] === 'number' ? analysis.scoring[dim.key] : 0;
                    return (
                      <div key={dim.key} className="flex items-center gap-3 px-3 py-2">
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
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Experience</p>
              <div className="space-y-2">
                {profile.work_experience.slice(0, 3).map((exp: any, i: number) => (
                  <div key={i} className="bg-neutral-900/50 rounded-lg p-3">
                    <p className="text-sm font-medium text-neutral-200">{exp.position || 'Untitled Role'}</p>
                    <p className="text-xs text-neutral-400">{exp.company || ''}</p>
                    {exp.start && (
                      <p className="text-xs text-neutral-500 mt-0.5">{exp.start} – {exp.end || 'Present'}</p>
                    )}
                  </div>
                ))}
                {profile.work_experience.length > 3 && (
                  <p className="text-xs text-neutral-500">+{profile.work_experience.length - 3} more</p>
                )}
              </div>
            </div>
          )}

          {/* Education */}
          {profile.education && profile.education.length > 0 && (
            <div>
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2">Education</p>
              <div className="space-y-2">
                {profile.education.slice(0, 2).map((edu: any, i: number) => (
                  <div key={i} className="bg-neutral-900/50 rounded-lg p-3">
                    <p className="text-sm font-medium text-neutral-200">{edu.school || 'Unknown School'}</p>
                    <p className="text-xs text-neutral-400">{edu.degree || ''}</p>
                  </div>
                ))}
              </div>
            </div>
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

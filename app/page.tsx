"use client";

import { useState, useEffect } from "react";

type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

interface JobResponse {
  id: string;
  status: JobStatus;
  totalTasks: number;
  processedCount: number;
  tasks: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
  };
}

export default function Home() {
  const [urls, setUrls] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<JobResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidUrls, setInvalidUrls] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryJob[]>([]);
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  // Analysis config state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [sheetWebAppUrl, setSheetWebAppUrl] = useState("");
  const [scoringRules, setScoringRules] = useState({
    stability: true, growth: true, graduation: true,
    companyType: true, mba: true, skillMatch: true, location: true,
  });
  const [customScoringRules, setCustomScoringRules] = useState<
    { id: string; name: string; maxPoints: number; criteria: string; enabled: boolean }[]
  >([]);
  const [aiModel, setAiModel] = useState("gpt-4.1-mini");
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleMax, setNewRuleMax] = useState(10);
  const [newRuleCriteria, setNewRuleCriteria] = useState("");

  // Calculate generic progress percentage
  const progress = jobData
    ? Math.round((jobData.processedCount / jobData.totalTasks) * 100)
    : 0;

  useEffect(() => {
    let interval: NodeJS.Timeout;

    const pollJobStatus = async () => {
      if (!jobId) return;

      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) throw new Error("Failed to fetch job status");

        const data: JobResponse = await res.json();
        setJobData(data);

        // Stop polling if completed or failed
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(interval);
        }
      } catch (err) {
        console.error(err);
      }
    };

    if (jobId) {
      // Poll initially and then every 2 seconds
      pollJobStatus();
      interval = setInterval(pollJobStatus, 2000);
    }

    return () => clearInterval(interval);
  }, [jobId]);

  // Fetch job history on mount and after new job creation
  useEffect(() => {
    fetchHistory();
  }, [jobId]);

  async function fetchHistory() {
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.jobs || []);
    } catch {
      // silently fail
    } finally {
      setInitialFetchDone(true);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urls.trim()) return;

    setLoading(true);
    setError(null);
    setInvalidUrls([]);
    setJobData(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          ...(jobDescription && {
            jobDescription,
            customPrompt: customPrompt || undefined,
            scoringRules,
            customScoringRules: customScoringRules.length > 0 ? customScoringRules : undefined,
            sheetWebAppUrl: sheetWebAppUrl || undefined,
            aiModel,
          }),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to submit job");
        if (data.invalidUrls) setInvalidUrls(data.invalidUrls);
        return;
      }

      setJobId(data.jobId);
      if (data.invalidUrls && data.invalidUrls.length > 0) {
        setInvalidUrls(data.invalidUrls);
      }
      setUrls(""); // clear on success
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const statusColors = {
    PENDING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PROCESSING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    COMPLETED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    FAILED: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    CANCELLED: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
  };

  return (
    <main className="space-y-8">
      {/* Header section */}
      <header className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Bulk URL Processor
        </h1>
        <p className="text-neutral-400">
          Scalable asynchronous background processing for LinkedIn URLs.
        </p>
      </header>

      {/* Input Section */}
      <section className="glassmorphism rounded-2xl p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="urls" className="text-sm font-medium text-neutral-300">
              LinkedIn URLs (one per line or space-separated)
            </label>
            <textarea
              id="urls"
              rows={6}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://www.linkedin.com/in/johndoe&#10;https://www.linkedin.com/in/janedoe"
              className="w-full resize-none rounded-xl bg-neutral-950/50 border border-neutral-800 p-4 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
              disabled={loading}
              required
            />
            <div className="flex justify-between text-xs text-neutral-500">
              <span>Supports bulk input</span>
              <span>{urls.split(/\s+/).filter(Boolean).length} URLs detected</span>
            </div>
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <svg className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showAdvanced ? 'Hide' : 'Show'} Analysis Settings
          </button>

          {/* Advanced Settings Panel */}
          {showAdvanced && (
            <div className="space-y-4 p-4 rounded-xl bg-neutral-950/50 border border-neutral-800">
              {/* Job Description */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-neutral-300">Job Description *</label>
                <textarea
                  rows={4}
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the Job Description here for AI scoring..."
                  className="w-full resize-none rounded-lg bg-neutral-900/50 border border-neutral-700 p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                />
                <p className="text-xs text-neutral-500">Profiles will be scored against this JD using an 85-point rubric.</p>
              </div>

              {/* Custom Prompt */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-neutral-300">Custom Recruiter Instructions (optional)</label>
                <textarea
                  rows={2}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="E.g., Prioritize candidates with B2B SaaS sales experience..."
                  className="w-full resize-none rounded-lg bg-neutral-900/50 border border-neutral-700 p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Scoring Rules Toggles */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Scoring Dimensions</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'stability', label: 'Stability', max: 10 },
                    { key: 'growth', label: 'Growth', max: 15 },
                    { key: 'graduation', label: 'Graduation', max: 15 },
                    { key: 'companyType', label: 'Company Type', max: 15 },
                    { key: 'mba', label: 'MBA', max: 15 },
                    { key: 'skillMatch', label: 'Skillset Match', max: 10 },
                    { key: 'location', label: 'Location', max: 5 },
                  ].map(rule => (
                    <button
                      key={rule.key}
                      type="button"
                      onClick={() => setScoringRules(prev => ({ ...prev, [rule.key]: !prev[rule.key as keyof typeof prev] }))}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                        scoringRules[rule.key as keyof typeof scoringRules]
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : 'bg-neutral-800/50 border-neutral-700 text-neutral-500 line-through'
                      }`}
                    >
                      {rule.label} ({rule.max})
                    </button>
                  ))}
                </div>
                <p className="text-xs text-neutral-500">
                  Max Score: {Object.entries(scoringRules)
                    .filter(([, v]) => v)
                    .reduce((sum, [k]) => sum + ({ stability: 10, growth: 15, graduation: 15, companyType: 15, mba: 15, skillMatch: 10, location: 5 }[k] || 0), 0)
                    + customScoringRules.filter(r => r.enabled).reduce((s, r) => s + r.maxPoints, 0)
                  } / {85 + customScoringRules.filter(r => r.enabled).reduce((s, r) => s + r.maxPoints, 0)}
                </p>
              </div>

              {/* Custom Scoring Rules */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Custom Rules</label>
                {customScoringRules.length > 0 && (
                  <div className="space-y-2">
                    {customScoringRules.map(rule => (
                      <div key={rule.id} className="flex items-center gap-2 p-2 rounded-lg bg-neutral-800/30 border border-neutral-700/50">
                        <button
                          type="button"
                          onClick={() => setCustomScoringRules(prev =>
                            prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r)
                          )}
                          className={`w-8 h-5 rounded-full transition-colors ${
                            rule.enabled ? 'bg-emerald-500' : 'bg-neutral-600'
                          }`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${
                            rule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                          }`} />
                        </button>
                        <span className={`text-sm flex-1 ${rule.enabled ? 'text-neutral-200' : 'text-neutral-500 line-through'}`}>
                          {rule.name} (/{rule.maxPoints})
                        </span>
                        <button
                          type="button"
                          onClick={() => setCustomScoringRules(prev => prev.filter(r => r.id !== rule.id))}
                          className="text-neutral-500 hover:text-rose-400 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-[1fr_60px_2fr_auto] gap-2 items-end">
                  <input
                    type="text"
                    value={newRuleName}
                    onChange={(e) => setNewRuleName(e.target.value)}
                    placeholder="Rule name"
                    className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="number"
                    value={newRuleMax}
                    onChange={(e) => setNewRuleMax(parseInt(e.target.value) || 10)}
                    placeholder="Max"
                    className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={newRuleCriteria}
                    onChange={(e) => setNewRuleCriteria(e.target.value)}
                    placeholder="Criteria description for AI"
                    className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newRuleName.trim() || !newRuleCriteria.trim()) return;
                      setCustomScoringRules(prev => [...prev, {
                        id: `cr_${Date.now()}`,
                        name: newRuleName,
                        maxPoints: newRuleMax,
                        criteria: newRuleCriteria,
                        enabled: true,
                      }]);
                      setNewRuleName(""); setNewRuleCriteria(""); setNewRuleMax(10);
                    }}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* AI Model Selector */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-neutral-300">AI Model</label>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                >
                  <option value="gpt-4.1">GPT-4.1 (Most Capable)</option>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini (Fast & Cheap)</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                </select>
                <p className="text-xs text-neutral-500">Higher models are more accurate but cost more per profile.</p>
              </div>

              {/* Google Sheets URL */}
              <div className="space-y-1">
                <label className="text-sm font-medium text-neutral-300">Google Sheets Web App URL (optional)</label>
                <input
                  type="url"
                  value={sheetWebAppUrl}
                  onChange={(e) => setSheetWebAppUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                />
                <p className="text-xs text-neutral-500">Auto-exports scored profiles to your Google Sheet.</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            {error ? (
              <p className="text-sm text-rose-400">{error}</p>
            ) : (
              <div />
            )}
            <button
              type="submit"
              disabled={loading || !urls.trim()}
              className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : (
                "Submit URLs"
              )}
            </button>
          </div>
        </form>

        {invalidUrls.length > 0 && (
          <div className="mt-4 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4">
            <h3 className="text-sm font-medium text-rose-400 mb-2">Skipped Invalid or Duplicate URLs:</h3>
            <ul className="list-disc pl-5 text-xs text-rose-300/70 max-h-32 overflow-y-auto space-y-1">
              {invalidUrls.map((url, i) => (
                <li key={i} className="truncate">{url}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Progress Section */}
      {jobId && (
        <section className="glassmorphism rounded-2xl p-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Job Tracking</h2>
              <p className="text-sm text-neutral-400 font-mono mt-1">ID: {jobId}</p>
            </div>
            {jobData && (
              <span className={`px-3 py-1 rounded-full text-xs font-medium border uppercase tracking-wider ${statusColors[jobData.status]}`}>
                {jobData.status}
              </span>
            )}
          </div>

          {jobData ? (
            <div className="space-y-6">
              {/* Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium text-neutral-300">
                  <span>Progress</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-3 w-full bg-neutral-800 rounded-full overflow-hidden border border-neutral-700">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500 ease-out relative"
                    style={{ width: `${progress}%` }}
                  >
                    {jobData.status === "PROCESSING" && (
                      <div className="absolute inset-0 bg-white/20 animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]" />
                    )}
                  </div>
                </div>
                <p className="text-xs text-neutral-500 float-right">
                  {jobData.processedCount} of {jobData.totalTasks} processed
                </p>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-neutral-800">
                <StatCard title="Pending" value={jobData.tasks.pending} color="text-blue-400" />
                <StatCard title="Processing" value={jobData.tasks.processing} color="text-amber-400" />
                <StatCard title="Done" value={jobData.tasks.done} color="text-emerald-400" />
                <StatCard title="Failed" value={jobData.tasks.failed} color="text-rose-400" />
              </div>

              {/* View Results Link */}
              {jobData.processedCount > 0 && (
                <div className="pt-4 border-t border-neutral-800 flex justify-center">
                  <a
                    href={`/jobs/${jobId}`}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all active:scale-95"
                  >
                    View Processed Data →
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-4 animate-pulse">
              <div className="h-4 bg-neutral-800 rounded w-1/4"></div>
              <div className="h-3 bg-neutral-800 rounded w-full"></div>
              <div className="grid grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 bg-neutral-800 rounded"></div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* History Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Job History</h2>
          <button
            onClick={fetchHistory}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Refresh
          </button>
        </div>

        {!initialFetchDone ? (
          <div className="space-y-2 animate-pulse">
             {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-neutral-800/50 rounded-xl w-full"></div>
             ))}
          </div>
        ) : history.length === 0 ? (
          <div className="glassmorphism rounded-2xl p-6 text-center">
            <p className="text-neutral-500 text-sm">No jobs yet. Submit some URLs above!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((job) => (
              <a
                key={job.id}
                href={`/jobs/${job.id}`}
                className="glassmorphism rounded-xl p-4 flex items-center gap-4 hover:bg-neutral-800/50 transition-colors group block"
              >
                {/* Status dot */}
                <div
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                    job.status === "COMPLETED"
                      ? "bg-emerald-400"
                      : job.status === "PROCESSING" || job.status === "PENDING"
                        ? "bg-amber-400 animate-pulse"
                        : job.status === "CANCELLED"
                          ? "bg-neutral-400"
                          : "bg-rose-400"
                  }`}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-300 font-mono truncate">
                    {job.id}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {new Date(job.createdAt).toLocaleString()} · {job.totalTasks} URL{job.totalTasks !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Progress */}
                <div className="text-right shrink-0">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded border ${
                      statusColors[job.status] || "bg-neutral-500/20 text-neutral-400 border-neutral-500/30"
                    }`}
                  >
                    {job.status}
                  </span>
                  <p className="text-xs text-neutral-500 mt-1">
                    {job.successCount}/{job.totalTasks} done
                  </p>
                </div>

                {/* Arrow */}
                <svg
                  className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({ title, value, color }: { title: string; value: number; color: string }) {
  return (
    <div className="bg-neutral-950/50 border border-neutral-800 rounded-xl p-4 flex flex-col items-center justify-center space-y-1 hover:bg-neutral-900 transition-colors">
      <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">{title}</span>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
    </div>
  );
}

interface HistoryJob {
  id: string;
  status: JobStatus;
  totalTasks: number;
  processedCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
}

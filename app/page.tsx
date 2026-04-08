"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type JobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" | "PAUSED";

// Scoring criteria descriptions matching LinkedIn scraper popup
const SCORING_RULE_DEFS = [
  {
    key: 'stability', label: 'Stability', max: 10, tiers: [
      { score: 10, color: 'text-emerald-400', text: 'Avg tenure > 2.5 years' },
      { score: 7, color: 'text-amber-400', text: 'Avg tenure 1.5 – 2.5 years' },
      { score: 0, color: 'text-rose-400', text: 'Avg tenure < 1.5 years' },
    ]
  },
  {
    key: 'growth', label: 'Growth', max: 15, tiers: [
      { score: 15, color: 'text-emerald-400', text: 'Internal promotion (higher role, same company)' },
      { score: 10, color: 'text-amber-400', text: 'External growth (higher role, new company)' },
      { score: 0, color: 'text-rose-400', text: 'No upward career movement detected' },
    ]
  },
  {
    key: 'graduation', label: 'Graduation', max: 15, tiers: [
      { score: 15, color: 'text-emerald-400', text: 'BTech/BE from Tier 1 institution' },
      { score: 10, color: 'text-amber-400', text: 'BTech/BE from Tier 2 institution' },
      { score: 7, color: 'text-amber-400', text: 'Non-BTech from Tier 1 institution' },
      { score: 5, color: 'text-amber-400', text: 'Non-BTech from Tier 2 institution' },
      { score: 0, color: 'text-rose-400', text: 'Unranked institution or no degree info' },
    ]
  },
  {
    key: 'companyType', label: 'Company Type', max: 15, tiers: [
      { score: 15, color: 'text-emerald-400', text: 'B2B Sales/CRM/SalesTech product company' },
      { score: 10, color: 'text-amber-400', text: 'B2B SaaS non-CRM (cloud, infra, HR tech, etc.)' },
      { score: 7, color: 'text-amber-400', text: 'Service-based / IT consulting company' },
      { score: 0, color: 'text-rose-400', text: 'B2C or unrelated company' },
    ]
  },
  {
    key: 'mba', label: 'MBA', max: 15, tiers: [
      { score: 15, color: 'text-emerald-400', text: 'MBA/PGDM from Tier 1 institution' },
      { score: 10, color: 'text-amber-400', text: 'MBA/PGDM from other institution' },
      { score: 0, color: 'text-rose-400', text: 'No MBA/PGDM' },
    ]
  },
  {
    key: 'skillMatch', label: 'Skill Match', max: 10, tiers: [
      { score: 10, color: 'text-emerald-400', text: '>70% of JD-required skills matched' },
      { score: 5, color: 'text-amber-400', text: '40–70% of JD-required skills matched' },
      { score: 0, color: 'text-rose-400', text: '<40% of JD-required skills matched' },
    ]
  },
  {
    key: 'location', label: 'Location', max: 5, tiers: [
      { score: 5, color: 'text-emerald-400', text: 'Candidate location matches JD location' },
      { score: 0, color: 'text-rose-400', text: 'Location does not match' },
    ]
  },
];

interface JdTemplate {
  id: string;
  title: string;
  content: string;
  scoringRules: Record<string, boolean>;
  customScoringRules: { id: string; name: string; maxPoints: number; criteria: string; enabled: boolean }[];
}

interface PromptTemplate {
  id: string;
  title: string;
  content: string;
}

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
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const HISTORY_PER_PAGE = 20;

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
  const [aiModel, setAiModel] = useState("gpt-4.1");
  const [aiProviderId, setAiProviderId] = useState<string | null>(null);
  const [minScoreThreshold, setMinScoreThreshold] = useState(70);
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleMax, setNewRuleMax] = useState(10);
  const [newRuleCriteria, setNewRuleCriteria] = useState("");

  // AI Provider list (for selector dropdown — managed in /settings)
  const [aiProviders, setAiProviders] = useState<any[]>([]);

  // JD Template library state
  const [jdTemplates, setJdTemplates] = useState<JdTemplate[]>([]);
  const [jdTemplateName, setJdTemplateName] = useState("");

  // Custom Prompt template library state
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [promptTemplateName, setPromptTemplateName] = useState("");

  // Template selection & editing state
  const [selectedJdTemplateId, setSelectedJdTemplateId] = useState<string | null>(null);
  const [editingJdTemplate, setEditingJdTemplate] = useState(false);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState<string | null>(null);
  const [editingPromptTemplate, setEditingPromptTemplate] = useState(false);
  const [showNewJdForm, setShowNewJdForm] = useState(false);
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);

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

        // Stop polling if terminal state
        if (data.status === "COMPLETED" || data.status === "FAILED" || data.status === "CANCELLED") {
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

  // Poll job history if any jobs are active
  useEffect(() => {
    const hasActiveJobs = history.some(
      (job) => job.status === "PENDING" || job.status === "PROCESSING" || job.status === "PAUSED"
    );
    if (!hasActiveJobs) return;

    const interval = setInterval(fetchHistory, 3000);
    return () => clearInterval(interval);
  }, [history]);

  // Load templates, settings, and AI providers from DB on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const [jdRes, promptRes, settingsRes, providersRes] = await Promise.all([
          fetch("/api/jd-templates"),
          fetch("/api/prompt-templates"),
          fetch("/api/settings"),
          fetch("/api/ai-providers"),
        ]);
        if (jdRes.ok) setJdTemplates(await jdRes.json());
        if (promptRes.ok) setPromptTemplates(await promptRes.json());
        if (providersRes.ok) setAiProviders(await providersRes.json());
        if (settingsRes.ok) {
          const s = await settingsRes.json();
          if (s.aiModel) setAiModel(s.aiModel);
          if (s.aiProviderId) setAiProviderId(s.aiProviderId);
          if (s.sheetWebAppUrl) setSheetWebAppUrl(s.sheetWebAppUrl);
          if (s.minScoreThreshold != null) setMinScoreThreshold(s.minScoreThreshold);
        }
      } catch { /* silently fail */ }
    }
    loadConfig();
  }, []);

  // Save settings to DB
  async function saveSettingsToStorage() {
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiModel, aiProviderId, sheetWebAppUrl, minScoreThreshold }),
      });
    } catch { /* silently fail */ }
  }

  // Load a JD template into the form
  function loadJdTemplate(template: JdTemplate) {
    setJobDescription(template.content);
    setScoringRules(template.scoringRules as typeof scoringRules);
    setCustomScoringRules(template.customScoringRules || []);
    setSelectedJdTemplateId(template.id);
    setEditingJdTemplate(false);
    setShowNewJdForm(false);
  }

  // Save current form state as a new JD template
  async function saveCurrentAsJdTemplate() {
    if (!jdTemplateName.trim() || !jobDescription.trim()) return;
    try {
      const res = await fetch("/api/jd-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: jdTemplateName,
          content: jobDescription,
          scoringRules: { ...scoringRules },
          customScoringRules: [...customScoringRules],
        }),
      });
      if (!res.ok) return;
      const newTemplate = await res.json();
      setJdTemplates([newTemplate, ...jdTemplates]);
      setJdTemplateName("");
      setSelectedJdTemplateId(newTemplate.id);
      setShowNewJdForm(false);
      setEditingJdTemplate(false);
    } catch { /* silently fail */ }
  }

  // Update an existing JD template in-place
  async function updateJdTemplate(id: string) {
    try {
      const res = await fetch(`/api/jd-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: jobDescription,
          scoringRules: { ...scoringRules },
          customScoringRules: [...customScoringRules],
        }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setJdTemplates(jdTemplates.map(t => t.id === id ? updated : t));
      setEditingJdTemplate(false);
    } catch { /* silently fail */ }
  }

  // Delete a JD template
  async function deleteJdTemplate(id: string) {
    try {
      const res = await fetch(`/api/jd-templates/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setJdTemplates(jdTemplates.filter(t => t.id !== id));
      if (selectedJdTemplateId === id) {
        setSelectedJdTemplateId(null);
        setEditingJdTemplate(false);
      }
    } catch { /* silently fail */ }
  }

  // Load a prompt template
  function loadPromptTemplate(template: PromptTemplate) {
    setCustomPrompt(template.content);
    setSelectedPromptTemplateId(template.id);
    setEditingPromptTemplate(false);
    setShowNewPromptForm(false);
  }

  // Save current prompt as a new template
  async function saveCurrentAsPromptTemplate() {
    if (!promptTemplateName.trim() || !customPrompt.trim()) return;
    try {
      const res = await fetch("/api/prompt-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: promptTemplateName, content: customPrompt }),
      });
      if (!res.ok) return;
      const newTemplate = await res.json();
      setPromptTemplates([newTemplate, ...promptTemplates]);
      setPromptTemplateName("");
      setSelectedPromptTemplateId(newTemplate.id);
      setShowNewPromptForm(false);
      setEditingPromptTemplate(false);
    } catch { /* silently fail */ }
  }

  // Update an existing prompt template in-place
  async function updatePromptTemplate(id: string) {
    const template = promptTemplates.find(t => t.id === id);
    if ((template as any)?.isDefault) return;
    try {
      const res = await fetch(`/api/prompt-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: customPrompt }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setPromptTemplates(promptTemplates.map(t => t.id === id ? updated : t));
      setEditingPromptTemplate(false);
    } catch { /* silently fail */ }
  }

  // Delete a prompt template
  async function deletePromptTemplate(id: string) {
    const template = promptTemplates.find(t => t.id === id);
    if ((template as any)?.isDefault) return;
    try {
      const res = await fetch(`/api/prompt-templates/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setPromptTemplates(promptTemplates.filter(t => t.id !== id));
      if (selectedPromptTemplateId === id) {
        setSelectedPromptTemplateId(null);
        setEditingPromptTemplate(false);
      }
    } catch { /* silently fail */ }
  }

  async function fetchHistory(page = historyPage) {
    try {
      const res = await fetch(`/api/jobs?page=${page}&limit=${HISTORY_PER_PAGE}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.jobs || []);
      if (data.pagination) {
        setHistoryPage(data.pagination.page);
        setHistoryTotalPages(data.pagination.totalPages);
        setHistoryTotal(data.pagination.total);
      }
    } catch {
      // silently fail
    } finally {
      setInitialFetchDone(true);
    }
  }

  async function handleJobAction(jobId: string, action: "pause" | "resume" | "cancel") {
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) fetchHistory();
    } catch (err) {
      console.error(`Failed to ${action} job:`, err);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urls.trim()) return;

    setLoading(true);
    setError(null);
    setInvalidUrls([]);
    setJobData(null);

    // Persist settings to DB
    saveSettingsToStorage();

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
            aiProviderId: aiProviderId || undefined,
            minScoreThreshold,
            jdTitle: jdTemplates.find(t => t.id === selectedJdTemplateId)?.title || "Bulk Analysis",
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
    PAUSED: "bg-violet-500/20 text-violet-400 border-violet-500/30",
    CANCELLED: "bg-neutral-500/20 text-neutral-400 border-neutral-500/30",
  };

  return (
    <main className="space-y-8">
      {/* Header section */}
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Bulk Profile Evaluator
          </h1>
          <Link
            href="/settings"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800/80 border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
        <p className="text-neutral-400">
          Automated evaluation and scoring of candidate LinkedIn profiles.
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

          {/* Analysis Config Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className={`flex items-center gap-2 w-full px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${showAdvanced ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-neutral-900/30 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            <span className="flex-1 text-left">Analysis Configuration</span>
            <svg className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Advanced Settings Panel */}
          {showAdvanced && (
            <div className="space-y-6 p-5 rounded-xl bg-neutral-950/50 border border-neutral-800">

              {/* ─── JD TEMPLATES SECTION ─── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Job Description
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">Select a saved template or write a new JD for AI scoring.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowNewJdForm(!showNewJdForm); setSelectedJdTemplateId(null); setJobDescription(""); setScoringRules({ stability: true, growth: true, graduation: true, companyType: true, mba: true, skillMatch: true, location: true }); setCustomScoringRules([]); setEditingJdTemplate(false); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-xs font-medium text-indigo-400 hover:bg-indigo-600/30 hover:text-indigo-300 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New Template
                  </button>
                </div>

                {/* Template Cards Grid */}
                {jdTemplates.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {jdTemplates.map(tpl => {
                      const isActive = selectedJdTemplateId === tpl.id;
                      return (
                        <div
                          key={tpl.id}
                          className={`group relative rounded-lg border p-3 cursor-pointer transition-all ${isActive
                              ? 'bg-indigo-500/10 border-indigo-500/40 ring-1 ring-indigo-500/20'
                              : 'bg-neutral-900/40 border-neutral-700/50 hover:border-neutral-600 hover:bg-neutral-800/40'
                            }`}
                          onClick={() => loadJdTemplate(tpl)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-indigo-400' : 'bg-neutral-600'}`} />
                                <span className={`text-sm font-medium truncate ${isActive ? 'text-indigo-300' : 'text-neutral-300'}`}>
                                  {tpl.title}
                                </span>
                              </div>
                              <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2 pl-4">
                                {tpl.content.slice(0, 120)}{tpl.content.length > 120 ? '…' : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); deleteJdTemplate(tpl.id); }}
                              className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-rose-400 transition-all p-1 rounded hover:bg-rose-500/10"
                              title="Delete template"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                          {isActive && (
                            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-indigo-500/20">
                              <span className="text-[10px] text-indigo-400/70 flex items-center gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                Active
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {jdTemplates.length === 0 && !showNewJdForm && (
                  <div className="rounded-lg border border-dashed border-neutral-700/50 p-4 text-center">
                    <p className="text-xs text-neutral-500">No saved JD templates yet. Click &quot;New Template&quot; to create one.</p>
                  </div>
                )}

                {/* JD Editor Area — shows when a template is selected or new template form is open */}
                {(selectedJdTemplateId || showNewJdForm) && (
                  <div className="space-y-2 p-3 rounded-lg bg-neutral-900/30 border border-neutral-800/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-neutral-400">
                        {showNewJdForm ? '✎ New Job Description' : editingJdTemplate ? '✎ Editing Template' : '📄 Template Content'}
                      </span>
                      {selectedJdTemplateId && !showNewJdForm && (
                        <button
                          type="button"
                          onClick={() => setEditingJdTemplate(!editingJdTemplate)}
                          className={`text-[11px] px-2 py-0.5 rounded transition-colors ${editingJdTemplate ? 'text-amber-400 bg-amber-500/10' : 'text-indigo-400 hover:text-indigo-300'}`}
                        >
                          {editingJdTemplate ? 'Cancel Edit' : 'Edit'}
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={5}
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      readOnly={!!(selectedJdTemplateId && !editingJdTemplate && !showNewJdForm)}
                      placeholder="Paste the Job Description here for AI scoring..."
                      className={`w-full resize-none rounded-lg border p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none transition-colors ${selectedJdTemplateId && !editingJdTemplate && !showNewJdForm
                          ? 'bg-neutral-950/30 border-neutral-800 cursor-default'
                          : 'bg-neutral-900/50 border-neutral-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
                        }`}
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-neutral-500">Profiles will be scored against this JD using an 85-point rubric.</p>
                      <div className="flex items-center gap-2">
                        {editingJdTemplate && selectedJdTemplateId && (
                          <button
                            type="button"
                            onClick={() => updateJdTemplate(selectedJdTemplateId)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/20 border border-emerald-500/30 text-[11px] font-medium text-emerald-400 hover:bg-emerald-600/30 transition-colors"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            Save Changes
                          </button>
                        )}
                        {showNewJdForm && jobDescription.trim() && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={jdTemplateName}
                              onChange={(e) => setJdTemplateName(e.target.value)}
                              placeholder="Template name..."
                              className="rounded-md bg-neutral-900/50 border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none w-36"
                            />
                            <button
                              type="button"
                              onClick={saveCurrentAsJdTemplate}
                              disabled={!jdTemplateName.trim()}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600/20 border border-indigo-500/30 text-[11px] font-medium text-indigo-400 hover:bg-indigo-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                              Save Template
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <hr className="border-neutral-800/50" />

              {/* ─── PROMPT TEMPLATES SECTION ─── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                      Recruiter Instructions
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">Custom prompts to guide AI evaluation. Select a saved one or create new.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setShowNewPromptForm(!showNewPromptForm); setSelectedPromptTemplateId(null); setCustomPrompt(""); setEditingPromptTemplate(false); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-xs font-medium text-violet-400 hover:bg-violet-600/30 hover:text-violet-300 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New Prompt
                  </button>
                </div>

                {/* Prompt Template Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {promptTemplates.map(tpl => {
                    const isActive = selectedPromptTemplateId === tpl.id;
                    const isDefault = !!(tpl as any).isDefault;
                    return (
                      <div
                        key={tpl.id}
                        className={`group relative rounded-lg border p-3 cursor-pointer transition-all ${isActive
                            ? 'bg-violet-500/10 border-violet-500/40 ring-1 ring-violet-500/20'
                            : 'bg-neutral-900/40 border-neutral-700/50 hover:border-neutral-600 hover:bg-neutral-800/40'
                          }`}
                        onClick={() => loadPromptTemplate(tpl)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-violet-400' : 'bg-neutral-600'}`} />
                              <span className={`text-sm font-medium truncate ${isActive ? 'text-violet-300' : 'text-neutral-300'}`}>
                                {tpl.title}
                              </span>
                              {isDefault && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-neutral-700/50 text-neutral-400 font-medium uppercase tracking-wider">Default</span>
                              )}
                            </div>
                            <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2 pl-4">
                              {tpl.content.slice(0, 120)}{tpl.content.length > 120 ? '…' : ''}
                            </p>
                          </div>
                          {!isDefault && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); deletePromptTemplate(tpl.id); }}
                              className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-rose-400 transition-all p-1 rounded hover:bg-rose-500/10"
                              title="Delete template"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          )}
                        </div>
                        {isActive && (
                          <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-violet-500/20">
                            <span className="text-[10px] text-violet-400/70 flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              Active
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Prompt Editor Area */}
                {(selectedPromptTemplateId || showNewPromptForm) && (
                  <div className="space-y-2 p-3 rounded-lg bg-neutral-900/30 border border-neutral-800/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-neutral-400">
                        {showNewPromptForm ? '✎ New Prompt' : editingPromptTemplate ? '✎ Editing Prompt' : '💬 Prompt Content'}
                      </span>
                      {selectedPromptTemplateId && !(promptTemplates.find(t => t.id === selectedPromptTemplateId) as any)?.isDefault && !showNewPromptForm && (
                        <button
                          type="button"
                          onClick={() => setEditingPromptTemplate(!editingPromptTemplate)}
                          className={`text-[11px] px-2 py-0.5 rounded transition-colors ${editingPromptTemplate ? 'text-amber-400 bg-amber-500/10' : 'text-violet-400 hover:text-violet-300'}`}
                        >
                          {editingPromptTemplate ? 'Cancel Edit' : 'Edit'}
                        </button>
                      )}
                    </div>
                    <textarea
                      rows={3}
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      readOnly={!!(selectedPromptTemplateId && !editingPromptTemplate && !showNewPromptForm)}
                      placeholder="E.g., Prioritize candidates with B2B SaaS sales experience..."
                      className={`w-full resize-none rounded-lg border p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none transition-colors ${selectedPromptTemplateId && !editingPromptTemplate && !showNewPromptForm
                          ? 'bg-neutral-950/30 border-neutral-800 cursor-default'
                          : 'bg-neutral-900/50 border-neutral-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500'
                        }`}
                    />
                    <div className="flex items-center justify-end gap-2">
                      {editingPromptTemplate && selectedPromptTemplateId && !(promptTemplates.find(t => t.id === selectedPromptTemplateId) as any)?.isDefault && (
                        <button
                          type="button"
                          onClick={() => updatePromptTemplate(selectedPromptTemplateId)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600/20 border border-emerald-500/30 text-[11px] font-medium text-emerald-400 hover:bg-emerald-600/30 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          Save Changes
                        </button>
                      )}
                      {showNewPromptForm && customPrompt.trim() && (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={promptTemplateName}
                            onChange={(e) => setPromptTemplateName(e.target.value)}
                            placeholder="Prompt name..."
                            className="rounded-md bg-neutral-900/50 border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 placeholder:text-neutral-600 focus:border-violet-500 focus:outline-none w-36"
                          />
                          <button
                            type="button"
                            onClick={saveCurrentAsPromptTemplate}
                            disabled={!promptTemplateName.trim()}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600/20 border border-violet-500/30 text-[11px] font-medium text-violet-400 hover:bg-violet-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                            Save Prompt
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <hr className="border-neutral-800/50" />

              {/* ─── AI MODEL SELECTOR ─── */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    AI Model
                  </h3>
                  <Link href="/settings" className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    Manage Providers
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={aiProviderId || ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      setAiProviderId(id);
                      if (id) {
                        const p = aiProviders.find((p: any) => p.id === id);
                        if (p && p.models?.length > 0) setAiModel(p.models[0]);
                      }
                    }}
                    className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                  >
                    <option value="">Default (OpenAI via env key)</option>
                    {aiProviders.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.isDefault ? " *" : ""}
                      </option>
                    ))}
                  </select>
                  {aiProviderId ? (
                    <select
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                    >
                      {(aiProviders.find((p: any) => p.id === aiProviderId)?.models || []).map((m: string) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                    >
                      <option value="gpt-4.1">GPT-4.1</option>
                      <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o Mini</option>
                    </select>
                  )}
                </div>
              </div>

              <hr className="border-neutral-800/50" />

              {/* ─── SCORING RULES (Collapsible — Dimensions + Custom) ─── */}
              <details className="group" open>
                <summary className="flex items-center gap-2 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                  <svg className="w-4 h-4 text-emerald-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  <h3 className="text-sm font-semibold text-white">Scoring Rules</h3>
                  <span className="text-[11px] text-neutral-500 font-mono ml-auto">
                    {Object.entries(scoringRules).filter(([, v]) => v).reduce((sum, [k]) => sum + ({ stability: 10, growth: 15, graduation: 15, companyType: 15, mba: 15, skillMatch: 10, location: 5 }[k] || 0), 0) + customScoringRules.filter(r => r.enabled).reduce((s, r) => s + r.maxPoints, 0)} pts max
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  {/* Built-in dimensions */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {SCORING_RULE_DEFS.map(rule => {
                      const enabled = scoringRules[rule.key as keyof typeof scoringRules];
                      return (
                        <button
                          key={rule.key}
                          type="button"
                          onClick={() => setScoringRules(prev => ({ ...prev, [rule.key]: !prev[rule.key as keyof typeof prev] }))}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all ${enabled ? 'bg-emerald-500/5 border-emerald-500/25 hover:border-emerald-500/40' : 'bg-neutral-900/20 border-neutral-800 opacity-50 hover:opacity-70'}`}
                        >
                          <div className={`w-7 h-4 rounded-full transition-colors shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-neutral-600'}`}>
                            <div className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </div>
                          <span className={`text-xs font-medium flex-1 ${enabled ? 'text-neutral-200' : 'text-neutral-500'}`}>{rule.label}</span>
                          <span className="text-[10px] text-neutral-500 font-mono">/{rule.max}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Custom rules */}
                  {customScoringRules.length > 0 && (
                    <div className="space-y-1.5 pt-2 border-t border-neutral-800/50">
                      <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">Custom Rules</span>
                      {customScoringRules.map(rule => (
                        <div key={rule.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${rule.enabled ? 'bg-amber-500/5 border-amber-500/20' : 'bg-neutral-900/20 border-neutral-800 opacity-50'}`}>
                          <button
                            type="button"
                            onClick={() => setCustomScoringRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                            className={`w-7 h-4 rounded-full transition-colors shrink-0 ${rule.enabled ? 'bg-amber-500' : 'bg-neutral-600'}`}
                          >
                            <div className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${rule.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </button>
                          <div className="flex-1 min-w-0">
                            <span className={`text-xs font-medium ${rule.enabled ? 'text-neutral-200' : 'text-neutral-500'}`}>{rule.name}</span>
                            <p className="text-[10px] text-neutral-500 truncate">{rule.criteria}</p>
                          </div>
                          <span className="text-[10px] text-neutral-500 font-mono">/{rule.maxPoints}</span>
                          <button type="button" onClick={() => setCustomScoringRules(prev => prev.filter(r => r.id !== rule.id))}
                            className="text-neutral-600 hover:text-rose-400 transition-colors p-0.5 rounded hover:bg-rose-500/10 shrink-0">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add custom rule — inline compact form */}
                  <details className="group/add">
                    <summary className="text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5 pt-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Add Custom Rule
                    </summary>
                    <div className="mt-2 p-3 rounded-lg bg-neutral-900/30 border border-neutral-800/50 space-y-2">
                      <div className="grid grid-cols-[1fr_60px] gap-2">
                        <input type="text" value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} placeholder="Rule name"
                          className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none" />
                        <input type="number" value={newRuleMax} onChange={(e) => setNewRuleMax(parseInt(e.target.value) || 10)} placeholder="Max"
                          className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-2 py-1.5 text-xs text-neutral-200 text-center focus:border-amber-500 focus:outline-none" />
                      </div>
                      <textarea rows={2} value={newRuleCriteria} onChange={(e) => setNewRuleCriteria(e.target.value)}
                        placeholder="Describe the criteria for the AI to evaluate..."
                        className="w-full resize-none rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-amber-500 focus:outline-none" />
                      <button type="button"
                        onClick={() => {
                          if (!newRuleName.trim() || !newRuleCriteria.trim()) return;
                          setCustomScoringRules(prev => [...prev, { id: `cr_${Date.now()}`, name: newRuleName, maxPoints: newRuleMax, criteria: newRuleCriteria, enabled: true }]);
                          setNewRuleName(""); setNewRuleCriteria(""); setNewRuleMax(10);
                        }}
                        disabled={!newRuleName.trim() || !newRuleCriteria.trim()}
                        className="w-full px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-500/30 text-amber-400 text-xs font-medium hover:bg-amber-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        Add Rule
                      </button>
                    </div>
                  </details>
                </div>
              </details>

              <hr className="border-neutral-800/50" />

              {/* ─── EXPORT SETTINGS (Collapsible) ─── */}
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                  <svg className="w-4 h-4 text-emerald-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  <h3 className="text-sm font-semibold text-white">Export to Google Sheets</h3>
                  {sheetWebAppUrl && <span className="text-[10px] text-emerald-400 ml-auto">Configured</span>}
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Web App URL</label>
                    <input type="url" value={sheetWebAppUrl} onChange={(e) => setSheetWebAppUrl(e.target.value)}
                      placeholder="https://script.google.com/macros/s/.../exec"
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                  </div>
                  {sheetWebAppUrl && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-400">Min Score Threshold ({minScoreThreshold}%)</label>
                      <input type="range" min={0} max={100} value={minScoreThreshold} onChange={(e) => setMinScoreThreshold(parseInt(e.target.value))}
                        className="w-full accent-indigo-500" />
                      <p className="text-[11px] text-neutral-500">Only export profiles scoring at or above this threshold.</p>
                    </div>
                  )}
                </div>
              </details>
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
          <h2 className="text-lg font-semibold text-white">
            Job History{historyTotal > 0 && <span className="text-neutral-500 text-sm font-normal ml-2">({historyTotal})</span>}
          </h2>
          <button
            onClick={() => fetchHistory()}
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
                  className={`h-2.5 w-2.5 rounded-full shrink-0 ${job.status === "COMPLETED"
                      ? "bg-emerald-400"
                      : job.status === "PROCESSING" || job.status === "PENDING"
                        ? "bg-amber-400 animate-pulse"
                        : job.status === "PAUSED"
                          ? "bg-violet-400"
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
                    className={`text-xs font-medium px-2 py-0.5 rounded border ${statusColors[job.status] || "bg-neutral-500/20 text-neutral-400 border-neutral-500/30"
                      }`}
                  >
                    {job.status}
                  </span>
                  <p className="text-xs text-neutral-500 mt-1">
                    {job.processedCount}/{job.totalTasks} processed
                  </p>
                </div>

                {/* Job Controls */}
                {(job.status === "PENDING" || job.status === "PROCESSING" || job.status === "PAUSED") && (
                  <div className="flex gap-1.5 shrink-0" onClick={(e) => e.preventDefault()}>
                    {job.status === "PAUSED" ? (
                      <button
                        onClick={() => handleJobAction(job.id, "resume")}
                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        onClick={() => handleJobAction(job.id, "pause")}
                        className="px-2.5 py-1 rounded-md text-xs font-medium bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors"
                      >
                        Pause
                      </button>
                    )}
                    <button
                      onClick={() => handleJobAction(job.id, "cancel")}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

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

            {/* Pagination Controls */}
            {historyTotalPages > 1 && (
              <div className="flex items-center justify-between pt-3">
                <p className="text-xs text-neutral-500">
                  Page {historyPage} of {historyTotalPages} · {historyTotal} total jobs
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchHistory(historyPage - 1)}
                    disabled={historyPage <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => fetchHistory(historyPage + 1)}
                    disabled={historyPage >= historyTotalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
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

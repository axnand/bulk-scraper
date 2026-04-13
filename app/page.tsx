"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { DEFAULT_RULE_PROMPTS, DEFAULT_CRITICAL_INSTRUCTIONS } from "@/lib/analyzer";
import { estimateCost, formatCost, MODEL_PRICING } from "@/lib/model-pricing";
import { parseAndValidateUrls } from "@/lib/validators";

const DEFAULT_ROLE = "You are a strict ATS evaluator.";

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
  builtInRuleDescriptions?: Record<string, string>;
}

interface EvaluationConfigType {
  id: string;
  title: string;
  isDefault: boolean;
  promptRole: string | null;
  criticalInstructions: string | null;
  promptGuidelines: string | null;
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
  lastProcessedName?: string | null;
}

interface SheetIntegrationType {
  id: string;
  name: string;
  url: string;
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
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [jobDescription, setJobDescription] = useState("");
  const [sheetWebAppUrl, setSheetWebAppUrl] = useState("");
  const [scoringRules, setScoringRules] = useState({
    stability: true, growth: true, graduation: true,
    companyType: true, mba: true, skillMatch: true, location: true,
  });
  const [customScoringRules, setCustomScoringRules] = useState<
    { id: string; name: string; maxPoints: number; criteria: string; enabled: boolean }[]
  >([]);
  const [aiModel, setAiModel] = useState("");
  const [aiProviderId, setAiProviderId] = useState<string | null>(null);
  const [aiProviderChosen, setAiProviderChosen] = useState(false);
  const [minScoreThreshold, setMinScoreThreshold] = useState(70);
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleMax, setNewRuleMax] = useState(10);
  const [newRuleCriteria, setNewRuleCriteria] = useState("");

  // Built-in rule description overrides (keyed by rule key e.g. "growth")
  const [builtInRuleDescriptions, setBuiltInRuleDescriptions] = useState<Record<string, string>>({});
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null);

  // Prompt config — working copy from selected eval config
  const [promptRole, setPromptRole] = useState("");
  const [promptGuidelines, setPromptGuidelines] = useState("");
  const [criticalInstructions, setCriticalInstructions] = useState("");

  // AI Provider list (for selector dropdown — managed in /settings)
  const [aiProviders, setAiProviders] = useState<any[]>([]);

  // JD Template library state
  const [jdTemplates, setJdTemplates] = useState<JdTemplate[]>([]);
  const [jdTemplateName, setJdTemplateName] = useState("");

  // Template selection & editing state
  const [selectedJdTemplateId, setSelectedJdTemplateId] = useState<string | null>(null);
  const [editingJdTemplate, setEditingJdTemplate] = useState(false);
  const [showNewJdForm, setShowNewJdForm] = useState(false);

  // ─── Evaluation Config state ───
  const [evaluationConfigs, setEvaluationConfigs] = useState<EvaluationConfigType[]>([]);
  const [selectedEvalConfigId, setSelectedEvalConfigId] = useState<string | null>(null);
  const [editingEvalConfig, setEditingEvalConfig] = useState(false);
  const [showNewEvalConfigInput, setShowNewEvalConfigInput] = useState(false);
  const [evalConfigName, setEvalConfigName] = useState("");

  // ─── Preview Prompt state ───
  const [previewPrompt, setPreviewPrompt] = useState<{ systemPrompt: string; userPrompt: string | null } | null>(null);
  const [previewPromptTab, setPreviewPromptTab] = useState<"system" | "user">("system");
  const [previewLoading, setPreviewLoading] = useState(false);

  // ─── Toast notifications ───
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);

  // ─── Title editing for templates/configs ───
  const [jdTemplateEditTitle, setJdTemplateEditTitle] = useState("");
  const [evalConfigEditTitle, setEvalConfigEditTitle] = useState("");

  // ─── Eval config save loading ───
  const [evalConfigSaving, setEvalConfigSaving] = useState(false);

  // ─── Sheets state ───
  const [sheetIntegrations, setSheetIntegrations] = useState<SheetIntegrationType[]>([]);
  const [isAddingSheet, setIsAddingSheet] = useState(false);
  const [newSheetName, setNewSheetName] = useState("");
  const [newSheetUrl, setNewSheetUrl] = useState("");
  const [editingSheetId, setEditingSheetId] = useState<string | null>(null);
  const [editSheetName, setEditSheetName] = useState("");
  const [editSheetUrl, setEditSheetUrl] = useState("");

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

  // Load templates, settings, eval configs, and AI providers from DB on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        const [jdRes, settingsRes, providersRes, evalConfigsRes, sheetsRes] = await Promise.all([
          fetch("/api/jd-templates"),
          fetch("/api/settings"),
          fetch("/api/ai-providers"),
          fetch("/api/evaluation-configs"),
          fetch("/api/sheet-integrations"),
        ]);
        if (jdRes.ok) setJdTemplates(await jdRes.json());
        if (providersRes.ok) {
          const providers = await providersRes.json();
          setAiProviders(providers);
          // Auto-select the default provider and its first model
          const def = providers.find((p: any) => p.isDefault);
          if (def) {
            setAiProviderChosen(true);
            setAiProviderId(def.id);
            if (def.models?.length > 0) setAiModel(def.models[0]);
          }
        }
        if (settingsRes.ok) {
          const s = await settingsRes.json();
          // Only restore sheet and threshold — model/provider require explicit selection per session
          if (s.sheetWebAppUrl) setSheetWebAppUrl(s.sheetWebAppUrl);
          if (s.minScoreThreshold != null) setMinScoreThreshold(s.minScoreThreshold);
        }
        if (evalConfigsRes.ok) {
          const configs: EvaluationConfigType[] = await evalConfigsRes.json();
          setEvaluationConfigs(configs);
          // Do not auto-select — user must choose explicitly
        }
        if (sheetsRes.ok) {
          const sheets = await sheetsRes.json();
          setSheetIntegrations(sheets);
        }
      } catch { /* silently fail */ }
    }
    loadConfig();
  }, []);

  // Lightweight toast helper — auto-dismisses after 3 seconds
  function showToast(message: string, type: 'success' | 'error' = 'success') {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }

  // Load an evaluation config into the working state (prompt fields only)
  function loadEvalConfigIntoState(config: EvaluationConfigType) {
    if (config.isDefault) {
      // System default — show built-in defaults
      setPromptRole(DEFAULT_ROLE);
      setCriticalInstructions(DEFAULT_CRITICAL_INSTRUCTIONS);
      setPromptGuidelines("");
    } else {
      setPromptRole(config.promptRole || "");
      setCriticalInstructions(config.criticalInstructions || "");
      setPromptGuidelines(config.promptGuidelines || "");
    }
  }

  // Select an eval config — auto-opens the editor for non-default configs
  function selectEvalConfig(config: EvaluationConfigType) {
    setSelectedEvalConfigId(config.id);
    loadEvalConfigIntoState(config);
    setEditingEvalConfig(!config.isDefault);
    setShowNewEvalConfigInput(false);
    setEvalConfigEditTitle(config.title);
  }

  // Create a new eval config (pre-filled with defaults, then auto-select and enable editing)
  async function createNewEvalConfig() {
    if (!evalConfigName.trim()) return;
    try {
      const res = await fetch("/api/evaluation-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: evalConfigName,
          promptRole: DEFAULT_ROLE,
          criticalInstructions: DEFAULT_CRITICAL_INSTRUCTIONS,
          promptGuidelines: null,
        }),
      });
      if (!res.ok) return;
      const newConfig = await res.json();
      setEvaluationConfigs(prev => {
        const defaultConfigs = prev.filter(c => c.isDefault);
        const rest = prev.filter(c => !c.isDefault);
        return [...defaultConfigs, newConfig, ...rest];
      });
      setEvalConfigName("");
      setSelectedEvalConfigId(newConfig.id);
      setEvalConfigEditTitle(newConfig.title);
      setPromptRole(DEFAULT_ROLE);
      setCriticalInstructions(DEFAULT_CRITICAL_INSTRUCTIONS);
      setPromptGuidelines("");
      setShowNewEvalConfigInput(false);
      setEditingEvalConfig(true);
      showToast("Config created!");
    } catch { /* silently fail */ }
  }

  // Update an existing eval config (prompt fields only)
  async function updateEvalConfig(id: string) {
    setEvalConfigSaving(true);
    try {
      const res = await fetch(`/api/evaluation-configs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(evalConfigEditTitle.trim() && { title: evalConfigEditTitle.trim() }),
          promptRole: promptRole || null,
          criticalInstructions: criticalInstructions || null,
          promptGuidelines: promptGuidelines || null,
        }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setEvaluationConfigs(prev => prev.map(c => c.id === id ? updated : c));
      setEditingEvalConfig(false);
      showToast("Config saved!");
    } catch { /* silently fail */ } finally {
      setEvalConfigSaving(false);
    }
  }

  // Delete an eval config
  async function deleteEvalConfig(id: string) {
    try {
      const res = await fetch(`/api/evaluation-configs/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setEvaluationConfigs(prev => prev.filter(c => c.id !== id));
      if (selectedEvalConfigId === id) {
        const defaultConfig = evaluationConfigs.find(c => c.isDefault);
        if (defaultConfig) {
          setSelectedEvalConfigId(defaultConfig.id);
          loadEvalConfigIntoState(defaultConfig);
        } else {
          setSelectedEvalConfigId(null);
        }
        setEditingEvalConfig(false);
      }
    } catch { /* silently fail */ }
  }

  // Preview prompt
  async function handlePreviewPrompt() {
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/preview-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptRole: promptRole || undefined,
          criticalInstructions: criticalInstructions || undefined,
          promptGuidelines: promptGuidelines || undefined,
          scoringRules,
          customScoringRules,
          builtInRuleDescriptions,
          jobDescription: jobDescription || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewPromptTab(data.userPrompt ? "user" : "system");
        setPreviewPrompt({ systemPrompt: data.systemPrompt, userPrompt: data.userPrompt ?? null });
      }
    } catch { /* silently fail */ } finally {
      setPreviewLoading(false);
    }
  }

  // Save settings to DB (only non-prompt fields now)
  async function saveSettingsToStorage() {
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiModel, aiProviderId, sheetWebAppUrl, minScoreThreshold,
        }),
      });
    } catch { /* silently fail */ }
  }

  async function handleAddSheet() {
    if (!newSheetName.trim() || !newSheetUrl.trim()) return;
    try {
      const res = await fetch("/api/sheet-integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSheetName, url: newSheetUrl }),
      });
      if (!res.ok) return;
      const newSheet = await res.json();
      setSheetIntegrations([newSheet, ...sheetIntegrations]);
      setSheetWebAppUrl(newSheet.url);
      setNewSheetName("");
      setNewSheetUrl("");
      setIsAddingSheet(false);
    } catch { /* silently fail */ }
  }

  async function handleDeleteSheet(id: string) {
    try {
      const res = await fetch(`/api/sheet-integrations/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      
      const sheetToDelete = sheetIntegrations.find(s => s.id === id);
      setSheetIntegrations(sheetIntegrations.filter(s => s.id !== id));
      
      if (sheetToDelete && sheetWebAppUrl === sheetToDelete.url) {
        setSheetWebAppUrl("");
      }
    } catch { /* silently fail */ }
  }

  async function handleUpdateSheet() {
    if (!editingSheetId || !editSheetName.trim() || !editSheetUrl.trim()) return;
    try {
      const originalSheet = sheetIntegrations.find(s => s.id === editingSheetId);
      const res = await fetch(`/api/sheet-integrations/${editingSheetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editSheetName, url: editSheetUrl }),
      });
      if (!res.ok) return;
      const updatedSheet = await res.json();
      setSheetIntegrations(sheetIntegrations.map(s => s.id === editingSheetId ? updatedSheet : s));
      // Only update the active URL if the sheet being edited was the active one
      if (originalSheet && originalSheet.url === sheetWebAppUrl) {
        setSheetWebAppUrl(updatedSheet.url);
      }
      setEditingSheetId(null);
    } catch { /* silently fail */ }
  }

  // Load a JD template into the form — loads JD text AND scoring rules
  function loadJdTemplate(template: JdTemplate) {
    setJdTemplateEditTitle(template.title);
    setJobDescription(template.content);
    if (template.scoringRules && Object.keys(template.scoringRules).length > 0) {
      setScoringRules(template.scoringRules as typeof scoringRules);
    }
    setCustomScoringRules(template.customScoringRules || []);
    setBuiltInRuleDescriptions(template.builtInRuleDescriptions || {});
    setExpandedRuleKey(null);
    setSelectedJdTemplateId(template.id);
    setEditingJdTemplate(false);
    setShowNewJdForm(false);
  }

  // Save current form state as a new JD template — includes scoring rules
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
          builtInRuleDescriptions: { ...builtInRuleDescriptions },
        }),
      });
      if (!res.ok) return;
      const newTemplate = await res.json();
      setJdTemplates([newTemplate, ...jdTemplates]);
      setJdTemplateName("");
      setJdTemplateEditTitle(newTemplate.title);
      setSelectedJdTemplateId(newTemplate.id);
      setShowNewJdForm(false);
      setEditingJdTemplate(false);
      showToast("Template saved!");
    } catch { /* silently fail */ }
  }

  // Update an existing JD template in-place — includes scoring rules
  async function updateJdTemplate(id: string) {
    try {
      const res = await fetch(`/api/jd-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(jdTemplateEditTitle.trim() && { title: jdTemplateEditTitle.trim() }),
          content: jobDescription,
          scoringRules: { ...scoringRules },
          customScoringRules: [...customScoringRules],
          builtInRuleDescriptions: { ...builtInRuleDescriptions },
        }),
      });
      if (!res.ok) return;
      const updated = await res.json();
      setJdTemplates(jdTemplates.map(t => t.id === id ? updated : t));
      setEditingJdTemplate(false);
      showToast("Template saved!");
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

    // Persist non-prompt settings to DB
    saveSettingsToStorage();

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          ...(jobDescription && {
            jobDescription,
            sheetWebAppUrl: sheetWebAppUrl || undefined,
            aiModel,
            aiProviderId: aiProviderId || undefined,
            minScoreThreshold,
            jdTitle: jdTemplates.find(t => t.id === selectedJdTemplateId)?.title || "Bulk Analysis",
            // Send evaluationConfigId for prompt config resolution
            evaluationConfigId: selectedEvalConfigId || undefined,
            // Send scoring fields inline from the JD working state
            scoringRules,
            customScoringRules: customScoringRules.length > 0 ? customScoringRules : undefined,
            builtInRuleDescriptions: Object.keys(builtInRuleDescriptions).length > 0 ? builtInRuleDescriptions : undefined,
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

  const selectedEvalConfig = evaluationConfigs.find(c => c.id === selectedEvalConfigId);

  return (
    <main className="space-y-8">
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map(toast => (
            <div
              key={toast.id}
              className={`px-4 py-2.5 rounded-lg border text-sm font-medium shadow-lg backdrop-blur-sm flex items-center gap-2 ${
                toast.type === 'error'
                  ? 'bg-rose-950/90 border-rose-500/40 text-rose-300'
                  : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-300'
              }`}
            >
              {toast.type === 'error' ? (
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              ) : (
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              )}
              {toast.message}
            </div>
          ))}
        </div>
      )}

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
            {(() => {
              if (!urls.trim()) return <p className="text-xs text-neutral-600">Paste LinkedIn profile URLs, one per line or space-separated.</p>;
              const { valid, invalid } = parseAndValidateUrls(urls);
              return (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-400 font-medium">✓ {valid.length} valid</span>
                  {invalid.length > 0 && <span className="text-neutral-500">· {invalid.length} skipped</span>}
                  {valid.length === 0 && <span className="text-amber-400">No valid LinkedIn URLs found</span>}
                </div>
              );
            })()}
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

              {/* ─── Setup Checklist ─── */}
              <div className="flex items-center gap-4 pb-4 border-b border-neutral-800/70">
                {[
                  { label: "Job Description", done: !!jobDescription.trim() },
                  { label: "Eval Config", done: !!selectedEvalConfigId },
                  { label: "AI Model", done: aiProviderChosen && !!aiModel },
                ].map(({ label, done }) => (
                  <div key={label} className={`flex items-center gap-1.5 text-xs font-medium ${done ? "text-emerald-400" : "text-amber-400"}`}>
                    {done
                      ? <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      : <></>}
                    {label}
                  </div>
                ))}
              </div>

              {/* ─── 1. JD TEMPLATES SECTION (with scoring rules inside) ─── */}
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
                    onClick={() => { setShowNewJdForm(!showNewJdForm); setSelectedJdTemplateId(null); setJobDescription(""); setEditingJdTemplate(false); }}
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
                                {tpl.content.slice(0, 120)}{tpl.content.length > 120 ? '...' : ''}
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

                {/* JD Editor Area */}
                {(selectedJdTemplateId || showNewJdForm) && (
                  <div className="space-y-2 p-3 rounded-lg bg-neutral-900/30 border border-neutral-800/50">
                    <div className="flex items-center justify-between gap-2">
                      {editingJdTemplate && selectedJdTemplateId ? (
                        <input
                          type="text"
                          value={jdTemplateEditTitle}
                          onChange={(e) => setJdTemplateEditTitle(e.target.value)}
                          className="text-xs font-medium text-neutral-200 rounded-md bg-neutral-900/50 border border-neutral-700 px-2 py-1 focus:border-indigo-500 focus:outline-none flex-1 max-w-[200px]"
                          placeholder="Template name"
                        />
                      ) : (
                        <span className="text-xs font-medium text-neutral-400">
                          {showNewJdForm ? 'New Job Description' : 'Template Content'}
                        </span>
                      )}
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
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] text-neutral-500">Profiles will be scored against this JD.</p>
                        {jobDescription.trim() && (
                          <span className="text-[11px] text-neutral-600 font-mono">· ~{Math.round(jobDescription.length / 4).toLocaleString()} tokens</span>
                        )}
                      </div>
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

                {/* ─── SCORING RULES (inside JD section, always editable) ─── */}
                <details className="group">
                  <summary className="flex items-center gap-2 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                    <svg className="w-4 h-4 text-emerald-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    <span className="text-xs font-semibold text-white">Scoring Rules</span>
                    <span className="text-[11px] text-neutral-500 font-mono ml-auto">
                      {Object.entries(scoringRules).filter(([, v]) => v).reduce((sum, [k]) => sum + ({ stability: 10, growth: 15, graduation: 15, companyType: 15, mba: 15, skillMatch: 10, location: 5 }[k] || 0), 0) + customScoringRules.filter(r => r.enabled).reduce((s, r) => s + r.maxPoints, 0)} pts max
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    {/* Built-in dimensions with expandable descriptions */}
                    <div className="space-y-1.5">
                      {SCORING_RULE_DEFS.map(rule => {
                        const enabled = scoringRules[rule.key as keyof typeof scoringRules];
                        const isExpanded = expandedRuleKey === rule.key;
                        const hasCustomDesc = rule.key in builtInRuleDescriptions;
                        const currentDesc = builtInRuleDescriptions[rule.key] ?? DEFAULT_RULE_PROMPTS[rule.key] ?? "";

                        return (
                          <div key={rule.key} className={`rounded-lg border transition-all ${enabled ? 'bg-emerald-500/5 border-emerald-500/25' : 'bg-neutral-900/20 border-neutral-800 opacity-50'}`}>
                            <div className="flex items-center gap-2.5 px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setScoringRules(prev => ({ ...prev, [rule.key]: !prev[rule.key as keyof typeof prev] }))}
                                className={`w-7 h-4 rounded-full transition-colors shrink-0 ${enabled ? 'bg-emerald-500' : 'bg-neutral-600'}`}
                              >
                                <div className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                              </button>
                              <span className={`text-xs font-medium flex-1 ${enabled ? 'text-neutral-200' : 'text-neutral-500'}`}>{rule.label}</span>
                              {hasCustomDesc && enabled && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium border border-amber-500/30">Edited</span>
                              )}
                              <span className="text-[10px] text-neutral-500 font-mono">/{rule.max}</span>
                              {enabled && DEFAULT_RULE_PROMPTS[rule.key] && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedRuleKey(isExpanded ? null : rule.key)}
                                  className="p-0.5 rounded text-neutral-500 hover:text-neutral-300 transition-colors"
                                  title={isExpanded ? "Collapse rule description" : "View/edit rule description"}
                                >
                                  <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                </button>
                              )}
                            </div>
                            {isExpanded && enabled && (
                              <div className="px-3 pb-3 space-y-1.5 border-t border-emerald-500/15 pt-2">
                                <textarea
                                  rows={6}
                                  value={currentDesc}
                                  onChange={(e) => setBuiltInRuleDescriptions(prev => ({
                                    ...prev,
                                    [rule.key]: e.target.value,
                                  }))}
                                  className="w-full resize-y rounded-lg border p-2.5 text-[11px] text-neutral-300 placeholder:text-neutral-600 focus:outline-none transition-colors leading-relaxed font-mono bg-neutral-950/50 border-neutral-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                                />
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] text-neutral-600">This description is sent to the AI as the scoring rule for &quot;{rule.label}&quot;.</p>
                                  {hasCustomDesc && (
                                    <button
                                      type="button"
                                      onClick={() => setBuiltInRuleDescriptions(prev => {
                                        const next = { ...prev };
                                        delete next[rule.key];
                                        return next;
                                      })}
                                      className="text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors flex items-center gap-1"
                                    >
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                      Reset to Default
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
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
              </div>

              <hr className="border-neutral-800/50" />

              {/* ─── 2. EVALUATION CONFIG SECTION (system prompt config only) ─── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                      Evaluation Config
                    </h3>
                    <p className="text-[11px] text-neutral-500 mt-0.5">AI evaluator role, critical instructions, and evaluation guidelines.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewEvalConfigInput(!showNewEvalConfigInput);
                      setEditingEvalConfig(false);
                      if (!showNewEvalConfigInput) {
                        setEvalConfigName("");
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 border border-violet-500/30 text-xs font-medium text-violet-400 hover:bg-violet-600/30 hover:text-violet-300 transition-all"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New Config
                  </button>
                </div>

                {/* New Config inline name input */}
                {showNewEvalConfigInput && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-neutral-900/30 border border-neutral-800/50">
                    <input
                      type="text"
                      value={evalConfigName}
                      onChange={(e) => setEvalConfigName(e.target.value)}
                      placeholder="Config name..."
                      className="flex-1 rounded-md bg-neutral-900/50 border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 placeholder:text-neutral-600 focus:border-violet-500 focus:outline-none"
                      onKeyDown={(e) => { if (e.key === 'Enter') createNewEvalConfig(); }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => createNewEvalConfig()}
                      disabled={!evalConfigName.trim()}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-violet-600/20 border border-violet-500/30 text-[11px] font-medium text-violet-400 hover:bg-violet-600/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Create Config
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewEvalConfigInput(false)}
                      className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                )}

                {/* Config Cards Grid */}
                {evaluationConfigs.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {evaluationConfigs.map(cfg => {
                      const isActive = selectedEvalConfigId === cfg.id;
                      const preview = cfg.isDefault
                        ? DEFAULT_ROLE
                        : cfg.promptRole || DEFAULT_ROLE;
                      return (
                        <div
                          key={cfg.id}
                          className={`group relative rounded-lg border p-3 cursor-pointer transition-all ${isActive
                            ? 'bg-violet-500/10 border-violet-500/40 ring-1 ring-violet-500/20'
                            : 'bg-neutral-900/40 border-neutral-700/50 hover:border-neutral-600 hover:bg-neutral-800/40'
                          }`}
                          onClick={() => selectEvalConfig(cfg)}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-violet-400' : 'bg-neutral-600'}`} />
                                <span className={`text-sm font-medium truncate ${isActive ? 'text-violet-300' : 'text-neutral-300'}`}>
                                  {cfg.title}
                                </span>
                                {cfg.isDefault && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-neutral-700/50 text-neutral-400 font-medium uppercase tracking-wider">Default</span>
                                )}
                              </div>
                              <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2 pl-4">
                                {preview.slice(0, 120)}{preview.length > 120 ? '...' : ''}
                              </p>
                            </div>
                            {!cfg.isDefault && (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); selectEvalConfig(cfg); setEditingEvalConfig(true); }}
                                  className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-violet-400 transition-all p-1 rounded hover:bg-violet-500/10"
                                  title="Edit config"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); deleteEvalConfig(cfg.id); }}
                                  className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-rose-400 transition-all p-1 rounded hover:bg-rose-500/10"
                                  title="Delete config"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                              </div>
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
                )}

                {/* Eval Config Editor — shows when a config is selected AND editing is enabled */}
                {selectedEvalConfigId && editingEvalConfig && selectedEvalConfig && !selectedEvalConfig.isDefault && (
                  <div className="space-y-3 p-3 rounded-lg bg-neutral-900/30 border border-neutral-800/50">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={evalConfigEditTitle}
                        onChange={(e) => setEvalConfigEditTitle(e.target.value)}
                        className="text-xs font-medium text-neutral-200 rounded-md bg-neutral-900/50 border border-neutral-700 px-2 py-1 focus:border-violet-500 focus:outline-none flex-1 max-w-[200px]"
                        placeholder="Config name"
                      />
                      <button
                        type="button"
                        onClick={() => setEditingEvalConfig(false)}
                        className="text-[11px] px-2 py-0.5 rounded transition-colors text-amber-400 bg-amber-500/10"
                      >
                        Cancel Edit
                      </button>
                    </div>

                    {/* Evaluator Role */}
                    <details className="group/eval">
                      <summary className="text-xs text-violet-400 hover:text-violet-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 transition-transform group-open/eval:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Evaluator Role
                        {promptRole && promptRole !== DEFAULT_ROLE && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-medium border border-violet-500/30 ml-1">Edited</span>}
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <textarea
                          rows={3}
                          value={promptRole || DEFAULT_ROLE}
                          onChange={(e) => setPromptRole(e.target.value)}
                          className="w-full resize-none rounded-lg border p-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none transition-colors leading-relaxed bg-neutral-900/50 border-neutral-700 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-neutral-600">Defines who the AI evaluator is and their expertise.</p>
                          {promptRole && promptRole !== DEFAULT_ROLE && (
                            <button
                              type="button"
                              onClick={() => setPromptRole(DEFAULT_ROLE)}
                              className="text-[10px] text-violet-400/70 hover:text-violet-400 transition-colors flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              Reset to Default
                            </button>
                          )}
                        </div>
                      </div>
                    </details>

                    {/* Critical Instructions */}
                    <details className="group/crit">
                      <summary className="text-xs text-amber-400 hover:text-amber-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 transition-transform group-open/crit:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Critical Instructions (Behavioral Rules)
                        {criticalInstructions && criticalInstructions !== DEFAULT_CRITICAL_INSTRUCTIONS && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium border border-amber-500/30 ml-1">Edited</span>}
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <textarea
                          rows={8}
                          value={criticalInstructions || DEFAULT_CRITICAL_INSTRUCTIONS}
                          onChange={(e) => setCriticalInstructions(e.target.value)}
                          className="w-full resize-y rounded-lg border p-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none transition-colors leading-relaxed font-mono bg-neutral-900/50 border-neutral-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-neutral-600">Core rules for consistency, evidence-based scoring, and disqualifier detection.</p>
                          {criticalInstructions && criticalInstructions !== DEFAULT_CRITICAL_INSTRUCTIONS && (
                            <button
                              type="button"
                              onClick={() => setCriticalInstructions(DEFAULT_CRITICAL_INSTRUCTIONS)}
                              className="text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors flex items-center gap-1"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              Reset to Default
                            </button>
                          )}
                        </div>
                      </div>
                    </details>

                    {/* Evaluation Guidelines */}
                    <details className="group/guide">
                      <summary className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 transition-transform group-open/guide:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Evaluation Guidelines
                        {promptGuidelines && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium border border-emerald-500/30 ml-1">Custom</span>}
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <textarea
                          rows={4}
                          value={promptGuidelines}
                          onChange={(e) => setPromptGuidelines(e.target.value)}
                          placeholder={"e.g.\n- Prioritize candidates from product B2B SaaS companies\n- Be strict about job hopping\n- Only count MBA from IIMs and ISB as Tier 1"}
                          className="w-full resize-y rounded-lg border p-3 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none transition-colors leading-relaxed bg-neutral-900/50 border-neutral-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                        />
                        <p className="text-[10px] text-neutral-600">Additional guidelines applied alongside the built-in scoring logic.</p>
                      </div>
                    </details>

                    {/* Save Changes button */}
                    <div className="flex items-center gap-2 pt-2 border-t border-neutral-800/50">
                      <button
                        type="button"
                        onClick={() => updateEvalConfig(selectedEvalConfigId)}
                        disabled={evalConfigSaving}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600/20 border border-emerald-500/30 text-[11px] font-medium text-emerald-400 hover:bg-emerald-600/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {evalConfigSaving ? (
                          <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Saving...
                          </>
                        ) : (
                          <>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            Save Changes
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Read-only view for System Default */}
                {selectedEvalConfigId && !editingEvalConfig && selectedEvalConfig?.isDefault && (
                  <div className="space-y-3 p-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
                    <span className="text-xs font-medium text-violet-300">System Default (Read-Only)</span>

                    <details className="group/eval">
                      <summary className="text-xs text-violet-400 hover:text-violet-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 transition-transform group-open/eval:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Evaluator Role
                      </summary>
                      <div className="mt-2">
                        <div className="w-full rounded-lg border p-3 text-xs text-neutral-400 leading-relaxed bg-neutral-950/30 border-neutral-800">
                          {DEFAULT_ROLE}
                        </div>
                      </div>
                    </details>

                    <details className="group/crit">
                      <summary className="text-xs text-amber-400 hover:text-amber-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 transition-transform group-open/crit:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Critical Instructions (Behavioral Rules)
                      </summary>
                      <div className="mt-2">
                        <div className="w-full rounded-lg border p-3 text-xs text-neutral-400 leading-relaxed font-mono whitespace-pre-wrap bg-neutral-950/30 border-neutral-800">
                          {DEFAULT_CRITICAL_INSTRUCTIONS}
                        </div>
                      </div>
                    </details>

                    <details className="group/guide">
                      <summary className="text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 transition-transform group-open/guide:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Evaluation Guidelines
                      </summary>
                      <div className="mt-2">
                        <div className="w-full rounded-lg border p-3 text-xs text-neutral-500 italic leading-relaxed bg-neutral-950/30 border-neutral-800">
                          No custom guidelines — using standard scoring logic only.
                        </div>
                      </div>
                    </details>
                  </div>
                )}

                {/* Compact summary for custom configs when NOT editing */}
                {selectedEvalConfigId && !editingEvalConfig && selectedEvalConfig && !selectedEvalConfig.isDefault && (
                  <div className="px-3 py-2 rounded-lg bg-neutral-900/20 border border-neutral-800/40">
                    <p className="text-[11px] text-neutral-500">
                      {`Using: ${selectedEvalConfig.promptRole ? 'Custom role' : 'Default role'}${selectedEvalConfig.criticalInstructions ? ', custom instructions' : ''}${selectedEvalConfig.promptGuidelines ? ', custom guidelines' : ''}.`}
                      <button
                        type="button"
                        onClick={() => setEditingEvalConfig(true)}
                        className="ml-2 text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2"
                      >
                        Edit
                      </button>
                    </p>
                  </div>
                )}
              </div>

              <hr className="border-neutral-800/50" />

              {/* ─── 3. AI MODEL SELECTOR ─── */}
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
                    value={!aiProviderChosen ? "__unset__" : (aiProviderId || "")}
                    onChange={(e) => {
                      if (e.target.value === "__unset__") return;
                      setAiProviderChosen(true);
                      const id = e.target.value || null;
                      setAiProviderId(id);
                      setAiModel("");
                      if (id) {
                        const p = aiProviders.find((p: any) => p.id === id);
                        if (p && p.models?.length > 0) setAiModel(p.models[0]);
                      }
                    }}
                    className={`w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-colors ${!aiProviderChosen ? "text-neutral-500" : "text-neutral-200"}`}
                  >
                    <option value="__unset__" disabled>— Select a provider —</option>
                    {aiProviders.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.isDefault ? " *" : ""}
                      </option>
                    ))}
                  </select>
                  {aiProviderId ? (
                    <select
                      value={aiModel || "__unset__"}
                      onChange={(e) => { if (e.target.value !== "__unset__") setAiModel(e.target.value); }}
                      className={`w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-colors ${!aiModel ? "text-neutral-500" : "text-neutral-200"}`}
                    >
                      <option value="__unset__" disabled>— Select a model —</option>
                      {(aiProviders.find((p: any) => p.id === aiProviderId)?.models || []).map((m: string) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="w-full rounded-lg bg-neutral-900/30 border border-neutral-800 px-3 py-2 text-sm text-neutral-600 flex items-center">
                      — Select a provider first —
                    </div>
                  )}
                </div>
                {/* Inline cost estimate */}
                {aiModel && (() => {
                  const estInput = 1500 + Math.round(jobDescription.length / 4);
                  const cost = estimateCost(estInput, 2000, aiModel);
                  if (!cost) return aiModel in MODEL_PRICING ? null : (
                    <p className="text-[11px] text-neutral-600 mt-1">pricing unknown for {aiModel}</p>
                  );
                  return (
                    <p className="text-[11px] text-neutral-500 mt-1">
                      Est. <span className="text-emerald-400 font-mono font-medium">{formatCost(cost.totalCost)}</span> / profile
                      <span className="text-neutral-600 ml-1">(in {formatCost(cost.inputCost)} + out {formatCost(cost.outputCost)})</span>
                    </p>
                  );
                })()}
              </div>

              <hr className="border-neutral-800/50" />

              {/* ─── 5. EXPORT SETTINGS (Collapsible) ─── */}
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
                  <svg className="w-4 h-4 text-emerald-400 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  <h3 className="text-sm font-semibold text-white">Export to Google Sheets</h3>
                  {sheetWebAppUrl && <span className="text-[10px] text-emerald-400 ml-auto">Configured</span>}
                </summary>
                <div className="mt-3 space-y-3">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-white">Google Sheet Integrations</h4>
                        <p className="text-[10px] text-neutral-500 mt-0.5">Select a destination for your exported analysis data</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingSheet(!isAddingSheet);
                          setEditingSheetId(null);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-xs font-medium text-emerald-400 hover:bg-emerald-600/30 hover:text-emerald-300 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                        {isAddingSheet ? "Cancel" : "New Sheet"}
                      </button>
                    </div>

                    {sheetIntegrations.length > 0 && !isAddingSheet && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Saved Sheets */}
                        {sheetIntegrations.map((sheet) => {
                          const isActive = sheetWebAppUrl === sheet.url;
                          const isEditingThis = editingSheetId === sheet.id;

                          if (isEditingThis) {
                            return (
                              <div key={sheet.id} className="col-span-1 sm:col-span-2 space-y-3 p-4 rounded-xl border border-indigo-500/40 bg-indigo-500/10 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl" />
                                <div className="relative">
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="text-[11px] text-indigo-400 font-semibold uppercase tracking-wider">Edit Integration</span>
                                    <button type="button" onClick={() => setEditingSheetId(null)} className="text-[11px] text-neutral-400 hover:text-neutral-200 bg-neutral-900/50 px-2 py-1 rounded">Cancel</button>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <input type="text" value={editSheetName} onChange={(e) => setEditSheetName(e.target.value)} placeholder="Sheet Name" className="rounded-lg bg-neutral-950/80 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none" />
                                    <input type="url" value={editSheetUrl} onChange={(e) => setEditSheetUrl(e.target.value)} placeholder="Web App URL" className="rounded-lg bg-neutral-950/80 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none" />
                                  </div>
                                  <div className="flex justify-end mt-3">
                                    <button type="button" onClick={handleUpdateSheet} disabled={!editSheetName.trim() || !editSheetUrl.trim()} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors shadow-lg shadow-indigo-900/20">Update Form</button>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={sheet.id}
                              className={`group relative rounded-xl border p-3.5 cursor-pointer transition-all duration-200 hover:shadow-lg ${
                                isActive
                                  ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/20 shadow-emerald-900/10'
                                  : 'bg-neutral-900/40 border-neutral-700/60 hover:border-neutral-500 hover:bg-neutral-800/60 shadow-black/20'
                              }`}
                              onClick={() => {
                                if (editingSheetId) return; // don't switch if currently editing something
                                if (isActive) {
                                  setSheetWebAppUrl(""); // deselect
                                } else {
                                  setSheetWebAppUrl(sheet.url);
                                }
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-neutral-600'}`} />
                                    <span className={`text-sm font-semibold truncate ${isActive ? 'text-emerald-300' : 'text-neutral-200'}`}>
                                      {sheet.name}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-neutral-500 truncate pl-4 font-mono group-hover:text-neutral-400 transition-colors">
                                    {sheet.url}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setEditingSheetId(sheet.id); setEditSheetName(sheet.name); setEditSheetUrl(sheet.url); setIsAddingSheet(false); }}
                                    className="p-1.5 rounded-md bg-neutral-800 text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/20 transition-colors"
                                    title="Edit Sheet"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteSheet(sheet.id); }}
                                    className="p-1.5 rounded-md bg-neutral-800 text-neutral-400 hover:text-rose-400 hover:bg-rose-500/20 transition-colors"
                                    title="Delete Sheet"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {isAddingSheet && (
                      <div className="space-y-3 p-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
                        <h4 className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider relative">New Google Sheet</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative">
                          <input type="text" value={newSheetName} onChange={(e) => setNewSheetName(e.target.value)} placeholder="Sheet Name (e.g. Sales Hiring Q3)" className="w-full rounded-lg bg-neutral-950/80 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none" />
                          <input type="url" value={newSheetUrl} onChange={(e) => setNewSheetUrl(e.target.value)} placeholder="Web App URL (https://script.google.com/macros/...)" className="w-full rounded-lg bg-neutral-950/80 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-emerald-500 focus:outline-none" />
                        </div>
                        <div className="flex justify-end gap-2 mt-2 relative">
                          <button type="button" onClick={() => setIsAddingSheet(false)} className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors">Cancel</button>
                          <button type="button" onClick={handleAddSheet} disabled={!newSheetName.trim() || !newSheetUrl.trim()} className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 disabled:opacity-50 transition-colors shadow-lg shadow-emerald-900/20">Save Integration</button>
                        </div>
                      </div>
                    )}

                    {sheetIntegrations.length === 0 && !isAddingSheet && (
                      <div className="flex flex-col items-center justify-center p-8 border border-dashed border-neutral-700/60 rounded-xl text-center bg-neutral-900/20 hover:bg-neutral-900/40 transition-colors cursor-pointer" onClick={() => setIsAddingSheet(true)}>
                        <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
                          <svg className="h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <p className="text-sm font-semibold text-neutral-300">No Google Sheets connected.</p>
                        <p className="text-xs text-neutral-500 mt-1 max-w-[250px]">Connect a sheet to automatically map scoring data to columns.</p>
                        <button type="button" className="mt-4 px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-semibold hover:bg-emerald-500/20 transition-colors">Add your first sheet &rarr;</button>
                      </div>
                    )}
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

          {(() => {
            const missing = [
              !jobDescription.trim() && "Job Description",
              !selectedEvalConfigId && "Eval Config",
              (!aiProviderChosen || !aiModel) && "AI Model",
            ].filter(Boolean) as string[];
            const canSubmit = urls.trim() && missing.length === 0;
            return (
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              {error ? (
                <p className="text-sm text-rose-400">{error}</p>
              ) : !canSubmit && urls.trim() ? (
                <p className="text-xs text-amber-400/80">Select: {missing.join(", ")}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {/* Preview Prompt Button */}
              <button
                type="button"
                onClick={handlePreviewPrompt}
                disabled={previewLoading}
                className="rounded-lg bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 border border-neutral-700 hover:bg-neutral-700 hover:text-white transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {previewLoading ? (
                  <svg className="animate-spin h-4 w-4 text-neutral-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                )}
                Preview Prompt
              </button>
              <button
                type="submit"
                disabled={loading || !canSubmit}
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
          </div>
            );
          })()}
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

      {/* Preview Prompt Modal */}
      {previewPrompt !== null && (() => {
        const sysTokens  = Math.round(previewPrompt.systemPrompt.length / 4);
        const userTokens = previewPrompt.userPrompt ? Math.round(previewPrompt.userPrompt.length / 4) : 0;
        const totalInputTokens = sysTokens + userTokens;
        const outputTokens = 2000; // max_tokens used by the analyzer
        const costPerProfile = aiModel ? estimateCost(totalInputTokens, outputTokens, aiModel) : null;
        const pricingKnown = aiModel ? aiModel in MODEL_PRICING : false;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setPreviewPrompt(null)}>
            <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-4xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-neutral-800">
                <div>
                  <h2 className="text-sm font-semibold text-white">Prompt Preview</h2>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    {previewPromptTab === "system"
                      ? `${previewPrompt.systemPrompt.length.toLocaleString()} chars · ~${sysTokens.toLocaleString()} tokens`
                      : previewPrompt.userPrompt
                        ? `${previewPrompt.userPrompt.length.toLocaleString()} chars · ~${userTokens.toLocaleString()} tokens (placeholder profile)`
                        : ""}
                  </p>
                </div>
                <button
                  onClick={() => setPreviewPrompt(null)}
                  className="text-neutral-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-neutral-800"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Cost estimate bar */}
              <div className="px-4 py-2.5 bg-neutral-950/60 border-b border-neutral-800 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-[11px] text-neutral-500">
                  Total input ~<span className="text-neutral-300 font-mono">{totalInputTokens.toLocaleString()}</span> tokens
                  {" "}+ <span className="text-neutral-300 font-mono">{outputTokens.toLocaleString()}</span> output (est.)
                </span>
                {costPerProfile ? (
                  <span className="text-[11px]">
                    <span className="text-neutral-500">≈ </span>
                    <span className="text-emerald-400 font-mono font-medium">{formatCost(costPerProfile.totalCost)}</span>
                    <span className="text-neutral-500"> / profile</span>
                    <span className="text-neutral-600 ml-2">
                      (in {formatCost(costPerProfile.inputCost)} + out {formatCost(costPerProfile.outputCost)})
                    </span>
                  </span>
                ) : aiModel && !pricingKnown ? (
                  <span className="text-[11px] text-neutral-600">pricing unknown for {aiModel}</span>
                ) : !aiModel ? (
                  <span className="text-[11px] text-neutral-600">select a model to see cost estimate</span>
                ) : null}
                <span className="text-[10px] text-neutral-700 ml-auto">prices approx. — verify at provider</span>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 px-4 pt-3 border-b border-neutral-800">
                <button
                  onClick={() => setPreviewPromptTab("system")}
                  className={`px-3 py-1.5 text-xs rounded-t font-medium transition-colors ${previewPromptTab === "system" ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-neutral-300"}`}
                >
                  System Prompt
                </button>
                <button
                  onClick={() => setPreviewPromptTab("user")}
                  disabled={!previewPrompt.userPrompt}
                  className={`px-3 py-1.5 text-xs rounded-t font-medium transition-colors ${previewPromptTab === "user" ? "bg-neutral-800 text-white" : "text-neutral-500 hover:text-neutral-300"} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  User Message {!previewPrompt.userPrompt && "(add JD first)"}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {previewPromptTab === "system" && (
                  <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">{previewPrompt.systemPrompt}</pre>
                )}
                {previewPromptTab === "user" && previewPrompt.userPrompt && (
                  <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">{previewPrompt.userPrompt}</pre>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-600">
                    {jobData.status === "PROCESSING" && jobData.lastProcessedName && (
                      <span className="text-neutral-500">↻ {jobData.lastProcessedName}</span>
                    )}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {jobData.processedCount} of {jobData.totalTasks} processed
                  </span>
                </div>
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

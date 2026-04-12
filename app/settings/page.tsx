"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Provider Presets ───────────────────────────────────────────────

const PROVIDER_PRESETS: Record<string, {
  label: string;
  name: string;
  baseUrl: string;
  providerType: string;
  suggestedModels: string[];
}> = {
  openai:    { label: "OpenAI",              name: "OpenAI",       baseUrl: "https://api.openai.com/v1",                                    providerType: "openai-compatible", suggestedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3-mini"] },
  gemini:    { label: "Google Gemini",       name: "Google Gemini",baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",      providerType: "openai-compatible", suggestedModels: ["gemini-2.5-pro-preview-03-25", "gemini-2.5-flash-preview-04-17", "gemini-2.0-flash", "gemini-1.5-pro"] },
  groq:      { label: "Groq",               name: "Groq",         baseUrl: "https://api.groq.com/openai/v1",                               providerType: "openai-compatible", suggestedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"] },
  anthropic: { label: "Anthropic (Claude)",  name: "Anthropic",    baseUrl: "https://api.anthropic.com/v1",                                 providerType: "anthropic",         suggestedModels: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"] },
  bedrock:   { label: "AWS Bedrock",         name: "AWS Bedrock",  baseUrl: "",                                                             providerType: "bedrock",           suggestedModels: ["anthropic.claude-3-5-sonnet-20241022-v2:0", "anthropic.claude-3-5-haiku-20241022-v1:0", "meta.llama3-70b-instruct-v1:0", "mistral.mistral-large-2402-v1:0", "amazon.nova-pro-v1:0"] },
  mistral:   { label: "Mistral",             name: "Mistral",      baseUrl: "https://api.mistral.ai/v1",                                    providerType: "openai-compatible", suggestedModels: ["mistral-large-latest", "mistral-small-latest", "open-mixtral-8x22b"] },
  deepseek:  { label: "DeepSeek",            name: "DeepSeek",     baseUrl: "https://api.deepseek.com/v1",                                  providerType: "openai-compatible", suggestedModels: ["deepseek-chat", "deepseek-reasoner"] },
  together:  { label: "Together AI",         name: "Together AI",  baseUrl: "https://api.together.xyz/v1",                                  providerType: "openai-compatible", suggestedModels: ["meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"] },
  ollama:    { label: "Ollama (Local)",       name: "Ollama",       baseUrl: "http://localhost:11434/v1",                                    providerType: "openai-compatible", suggestedModels: ["llama3.2", "llama3.1", "mistral", "qwen2.5", "phi4"] },
  custom:    { label: "Custom / Self-hosted", name: "",             baseUrl: "",                                                             providerType: "openai-compatible", suggestedModels: [] },
};

const BEDROCK_REGIONS = [
  { value: "us-east-1",      label: "US East (N. Virginia)" },
  { value: "us-west-2",      label: "US West (Oregon)" },
  { value: "eu-west-1",      label: "Europe (Ireland)" },
  { value: "eu-central-1",   label: "Europe (Frankfurt)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { value: "ap-south-1",     label: "Asia Pacific (Mumbai)" },
];

// ─── Types ─────────────────────────────────────────────────────────

interface Account {
  id: string;
  accountId: string;
  name: string;
  dsn: string;
  apiKey: string;
  status: string;
  requestCount: number;
  dailyCount: number;
  dailyResetAt: string | null;
  cooldownUntil: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface AiProvider {
  id: string;
  name: string;
  provider: string;
  baseUrl: string; // For Bedrock: AWS region
  apiKey: string;
  secretKey?: string | null; // "••••" when present (Bedrock only)
  models: string[];
  isDefault: boolean;
  createdAt: string;
}

// ─── Page Component ────────────────────────────────────────────────

export default function SettingsPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<"accounts" | "models">("accounts");

  // ── Unipile Accounts state ──
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formAccountId, setFormAccountId] = useState("");
  const [formDsn, setFormDsn] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [testResult, setTestResult] = useState<{
    success?: boolean;
    message?: string;
    error?: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDsn, setEditDsn] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editAccountId, setEditAccountId] = useState("");

  // ── AI Providers state ──
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  // ── Add provider form state ──
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("openai");
  const [newProviderName, setNewProviderName] = useState("OpenAI");
  const [newProviderApiKey, setNewProviderApiKey] = useState("");
  const [newProviderCustomBaseUrl, setNewProviderCustomBaseUrl] = useState("");
  const [newProviderCustomType, setNewProviderCustomType] = useState("openai-compatible");
  const [newProviderSecretKey, setNewProviderSecretKey] = useState(""); // Bedrock secret key
  const [newSelectedModels, setNewSelectedModels] = useState<string[]>([]);
  const [newCustomModelInput, setNewCustomModelInput] = useState("");
  const [providerTestResult, setProviderTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerTestLoading, setProviderTestLoading] = useState(false);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [providerSubmitting, setProviderSubmitting] = useState(false);

  // ── Edit existing provider state ──
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editProviderName, setEditProviderName] = useState("");
  const [editProviderApiKey, setEditProviderApiKey] = useState("");
  const [editProviderSecretKey, setEditProviderSecretKey] = useState(""); // Bedrock only
  const [editSelectedModels, setEditSelectedModels] = useState<string[]>([]);
  const [editCustomModelInput, setEditCustomModelInput] = useState("");
  const [editTestResult, setEditTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editTestLoading, setEditTestLoading] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // ── Quick-test existing providers (from card) ──
  const [quickTestId, setQuickTestId] = useState<string | null>(null);
  const [quickTestResults, setQuickTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // ── Data Fetching ──

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/accounts", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch accounts");
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (err: any) {
      setAccountsError(err.message);
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/ai-providers", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch providers");
      setAiProviders(await res.json());
    } catch { /* silently fail */ } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchProviders();
    const interval = setInterval(fetchAccounts, 5000);
    return () => clearInterval(interval);
  }, [fetchAccounts, fetchProviders]);

  // ── Unipile Account Handlers ──

  async function handleTestConnection() {
    if (!formDsn || !formApiKey || !formAccountId) {
      setTestResult({ error: "Fill in Account ID, DSN, and API Key first." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/accounts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dsn: formDsn, apiKey: formApiKey, accountId: formAccountId }),
      });
      setTestResult(await res.json());
    } catch {
      setTestResult({ error: "Network error — could not reach server." });
    } finally {
      setTesting(false);
    }
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!formAccountId || !formDsn || !formApiKey) return;
    setFormSubmitting(true);
    setFormError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: formName, accountId: formAccountId, dsn: formDsn, apiKey: formApiKey }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "Failed to create account"); return; }
      setFormName(""); setFormAccountId(""); setFormDsn(""); setFormApiKey("");
      setShowAddForm(false); setTestResult(null);
      fetchAccounts();
    } catch { setFormError("Network error"); } finally { setFormSubmitting(false); }
  }

  async function handleDeleteAccount(id: string) {
    if (!confirm("Are you sure you want to delete this account?")) return;
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (!res.ok) { const data = await res.json(); alert(data.error || "Failed to delete"); return; }
      fetchAccounts();
    } catch { alert("Network error"); }
  }

  async function handleToggleStatus(id: string, currentStatus: string) {
    const newStatus = currentStatus === "DISABLED" ? "ACTIVE" : "DISABLED";
    try {
      await fetch(`/api/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchAccounts();
    } catch { alert("Failed to update status"); }
  }

  async function handleSaveEdit(id: string) {
    try {
      const updateData: any = { name: editName, dsn: editDsn, accountId: editAccountId };
      if (editApiKey && !editApiKey.includes("•")) updateData.apiKey = editApiKey;
      await fetch(`/api/accounts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      setEditingId(null);
      fetchAccounts();
    } catch { alert("Failed to update"); }
  }

  function startEditing(account: Account) {
    setEditingId(account.id);
    setEditName(account.name);
    setEditDsn(account.dsn);
    setEditApiKey(account.apiKey.length > 14 ? `••••••••${account.apiKey.slice(-4)}` : account.apiKey);
    setEditAccountId(account.accountId);
  }

  // ── AI Provider Helpers ──

  function getEffectiveBaseUrl() {
    // Bedrock uses region (stored in customBaseUrl); custom uses whatever user typed
    if (selectedPreset === "bedrock" || selectedPreset === "custom") return newProviderCustomBaseUrl;
    return PROVIDER_PRESETS[selectedPreset]?.baseUrl ?? "";
  }

  function getEffectiveProviderType() {
    return selectedPreset === "custom" ? newProviderCustomType : PROVIDER_PRESETS[selectedPreset]?.providerType ?? "openai-compatible";
  }

  function handlePresetChange(preset: string) {
    setSelectedPreset(preset);
    const p = PROVIDER_PRESETS[preset];
    if (p.name) setNewProviderName(p.name);
    setNewSelectedModels([]);
    setNewCustomModelInput("");
    setNewProviderSecretKey("");
    setProviderTestResult(null);
    // Default Bedrock to us-east-1 (stored in customBaseUrl which doubles as region)
    if (preset === "bedrock") setNewProviderCustomBaseUrl("us-east-1");
    else if (preset !== "custom") setNewProviderCustomBaseUrl("");
  }

  function toggleNewModel(model: string) {
    setNewSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    );
  }

  function addNewCustomModel() {
    const m = newCustomModelInput.trim();
    if (!m || newSelectedModels.includes(m)) return;
    setNewSelectedModels(prev => [...prev, m]);
    setNewCustomModelInput("");
  }

  function toggleEditModel(model: string) {
    setEditSelectedModels(prev =>
      prev.includes(model) ? prev.filter(m => m !== model) : [...prev, model]
    );
  }

  function addEditCustomModel() {
    const m = editCustomModelInput.trim();
    if (!m || editSelectedModels.includes(m)) return;
    setEditSelectedModels(prev => [...prev, m]);
    setEditCustomModelInput("");
  }

  // ── AI Provider Handlers ──

  async function handleTestNewProvider() {
    const baseUrl = getEffectiveBaseUrl();
    const model = newSelectedModels[0];
    const isBedrock = selectedPreset === "bedrock";
    if (!baseUrl || !newProviderApiKey || !model) {
      setProviderTestResult({ success: false, message: "Select at least one model and enter your credentials first." });
      return;
    }
    if (isBedrock && !newProviderSecretKey) {
      setProviderTestResult({ success: false, message: "Secret Access Key is required for Bedrock." });
      return;
    }
    setProviderTestLoading(true);
    setProviderTestResult(null);
    try {
      const res = await fetch("/api/ai-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: getEffectiveProviderType(),
          baseUrl,
          apiKey: newProviderApiKey,
          ...(isBedrock && { secretKey: newProviderSecretKey }),
          model,
        }),
      });
      const data = await res.json();
      setProviderTestResult({ success: data.success, message: data.error || "Connection successful!" });
    } catch (err: any) {
      setProviderTestResult({ success: false, message: err.message });
    } finally {
      setProviderTestLoading(false);
    }
  }

  async function handleAddProvider(e: React.FormEvent) {
    e.preventDefault();
    if (newSelectedModels.length === 0 || !newProviderApiKey || !newProviderName) return;
    const baseUrl = getEffectiveBaseUrl();
    if (!baseUrl) { setProviderFormError("Base URL is required"); return; }
    setProviderSubmitting(true);
    setProviderFormError(null);
    try {
      const res = await fetch("/api/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProviderName,
          provider: getEffectiveProviderType(),
          baseUrl,
          apiKey: newProviderApiKey,
          ...(newProviderSecretKey && { secretKey: newProviderSecretKey }),
          models: newSelectedModels,
          isDefault: aiProviders.length === 0,
        }),
      });
      if (!res.ok) { const data = await res.json(); setProviderFormError(data.error || "Failed to add provider"); return; }
      // Reset form
      setSelectedPreset("openai");
      setNewProviderName("OpenAI");
      setNewProviderApiKey("");
      setNewProviderSecretKey("");
      setNewProviderCustomBaseUrl("");
      setNewSelectedModels([]);
      setNewCustomModelInput("");
      setShowAddProvider(false);
      setProviderTestResult(null);
      fetchProviders();
    } catch { setProviderFormError("Network error"); } finally { setProviderSubmitting(false); }
  }

  function startEditProvider(provider: AiProvider) {
    setEditingProviderId(provider.id);
    setEditProviderName(provider.name);
    setEditProviderApiKey(`••••${provider.apiKey.slice(-4)}`);
    // For Bedrock: show "••••" if a secret key exists, empty if not
    setEditProviderSecretKey(provider.secretKey ? "••••" : "");
    setEditSelectedModels(provider.models || []);
    setEditCustomModelInput("");
    setEditTestResult(null);
  }

  async function handleSaveEditProvider(id: string) {
    if (editSelectedModels.length === 0 || !editProviderName) return;
    setEditSubmitting(true);
    try {
      const updateData: any = {
        id,
        name: editProviderName,
        models: editSelectedModels,
      };
      // Only update API key if user typed a new one (not the masked placeholder)
      if (editProviderApiKey && !editProviderApiKey.startsWith("••••")) {
        updateData.apiKey = editProviderApiKey;
      }
      // Only update secret key if user typed a new one (not the masked "••••")
      if (editProviderSecretKey && editProviderSecretKey !== "••••") {
        updateData.secretKey = editProviderSecretKey;
      }
      const res = await fetch("/api/ai-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      });
      if (res.ok) {
        setEditingProviderId(null);
        fetchProviders();
      }
    } catch { alert("Failed to update"); } finally { setEditSubmitting(false); }
  }

  async function handleTestEditProvider(provider: AiProvider) {
    const model = editSelectedModels[0] || provider.models?.[0];
    if (!model) { setEditTestResult({ success: false, message: "Add at least one model first." }); return; }
    setEditTestLoading(true);
    setEditTestResult(null);
    try {
      const res = await fetch("/api/ai-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, model }),
      });
      const data = await res.json();
      setEditTestResult({ success: data.success, message: data.error || "Connection successful!" });
    } catch (err: any) {
      setEditTestResult({ success: false, message: err.message });
    } finally { setEditTestLoading(false); }
  }

  async function handleQuickTest(provider: AiProvider) {
    const model = provider.models?.[0];
    if (!model) return;
    setQuickTestId(provider.id);
    try {
      const res = await fetch("/api/ai-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, model }),
      });
      const data = await res.json();
      setQuickTestResults(prev => ({
        ...prev,
        [provider.id]: { success: data.success, message: data.error || "Connection OK" },
      }));
    } catch {
      setQuickTestResults(prev => ({ ...prev, [provider.id]: { success: false, message: "Network error" } }));
    } finally { setQuickTestId(null); }
  }

  async function handleDeleteProvider(id: string) {
    const provider = aiProviders.find(p => p.id === id);
    if (!provider) return;

    let warning = "Remove this AI provider?";
    if (provider.isDefault) {
      warning = "This is your default provider. Removing it means no provider will be set as default and the system will fall back to the OPENAI_API_KEY environment variable. Continue?";
    }
    if (!confirm(warning)) return;

    try {
      const res = await fetch(`/api/ai-providers?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchProviders();
    } catch { alert("Network error"); }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch("/api/ai-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isDefault: true }),
      });
      if (res.ok) fetchProviders();
    } catch { alert("Failed to update"); }
  }

  // ── UI Helpers ──

  const statusConfig: Record<string, { color: string; bg: string; border: string; dot: string; label: string }> = {
    ACTIVE:   { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400",              label: "Active" },
    BUSY:     { color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   dot: "bg-amber-400 animate-pulse",  label: "Processing" },
    COOLDOWN: { color: "text-orange-400",  bg: "bg-orange-500/10",  border: "border-orange-500/30",  dot: "bg-orange-400",               label: "Cooldown" },
    DISABLED: { color: "text-neutral-400", bg: "bg-neutral-500/10", border: "border-neutral-500/30", dot: "bg-neutral-500",              label: "Disabled" },
  };

  const activeCount = accounts.filter((a) => a.status === "ACTIVE" || a.status === "BUSY").length;

  const providerTypeLabels: Record<string, string> = {
    "openai-compatible": "OpenAI-Compatible",
    "anthropic": "Anthropic (Claude)",
    "bedrock": "AWS Bedrock",
  };

  const currentPreset = PROVIDER_PRESETS[selectedPreset];

  return (
    <main className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-white">Settings</h1>
        <p className="text-neutral-400">Manage Unipile accounts and AI model configurations.</p>
      </header>

      {/* Tab Switcher */}
      <div className="flex gap-1 p-1 rounded-xl bg-neutral-900/50 border border-neutral-800 w-fit">
        <button
          onClick={() => setActiveTab("accounts")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "accounts" ? "bg-indigo-600 text-white shadow-sm" : "text-neutral-400 hover:text-white hover:bg-neutral-800"}`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
            Unipile Accounts
          </span>
        </button>
        <button
          onClick={() => setActiveTab("models")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "models" ? "bg-indigo-600 text-white shadow-sm" : "text-neutral-400 hover:text-white hover:bg-neutral-800"}`}
        >
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Models Configuration
          </span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          TAB 1: UNIPILE ACCOUNTS
          ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "accounts" && (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{accounts.length}</p>
              <p className="text-xs text-neutral-500 mt-1">Total Accounts</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{activeCount}</p>
              <p className="text-xs text-neutral-500 mt-1">Active Workers</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-400">{accounts.filter((a) => a.status === "BUSY").length}</p>
              <p className="text-xs text-neutral-500 mt-1">Processing</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-orange-400">{accounts.filter((a) => a.status === "COOLDOWN").length}</p>
              <p className="text-xs text-neutral-500 mt-1">In Cooldown</p>
            </div>
          </div>

          {/* Accounts Section */}
          <section className="glassmorphism rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                Unipile Accounts
              </h2>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Account
              </button>
            </div>

            {/* Add Account Form */}
            {showAddForm && (
              <form onSubmit={handleAddAccount} className="space-y-4 p-5 rounded-xl bg-neutral-950/50 border border-neutral-800 mb-6">
                <h3 className="text-sm font-semibold text-white">New Unipile Account</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Friendly Name</label>
                    <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g., LinkedIn Account 1"
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Unipile Account ID <span className="text-rose-400">*</span></label>
                    <input type="text" value={formAccountId} onChange={(e) => setFormAccountId(e.target.value)}
                      placeholder="e.g., abc123def456" required
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-400">DSN Endpoint <span className="text-rose-400">*</span></label>
                  <input type="url" value={formDsn} onChange={(e) => setFormDsn(e.target.value)}
                    placeholder="https://api36.unipile.com:16688" required
                    className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-400">API Key <span className="text-rose-400">*</span></label>
                  <input type="password" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder="Your Unipile API key" required
                    className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors font-mono" />
                </div>

                {testResult && (
                  <div className={`rounded-lg p-3 border text-sm ${testResult.success ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"}`}>
                    <div className="flex items-center gap-2">
                      {testResult.success
                        ? <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
                      <span>{testResult.message || testResult.error}</span>
                    </div>
                  </div>
                )}
                {formError && <p className="text-sm text-rose-400">{formError}</p>}

                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={handleTestConnection}
                    disabled={testing || !formDsn || !formApiKey || !formAccountId}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    {testing
                      ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Testing...</>
                      : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test Connection</>}
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => { setShowAddForm(false); setTestResult(null); setFormError(null); }}
                      className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:text-white transition-colors">Cancel</button>
                    <button type="submit" disabled={formSubmitting || !formAccountId || !formDsn || !formApiKey}
                      className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                      {formSubmitting ? "Saving..." : "Save Account"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Account List */}
            {accountsLoading ? (
              <div className="space-y-3 animate-pulse">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-neutral-800/50 rounded-xl" />)}</div>
            ) : accountsError ? (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-center">
                <p className="text-sm text-rose-400">{accountsError}</p>
              </div>
            ) : accounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-700/50 p-8 text-center">
                <svg className="w-12 h-12 text-neutral-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                <p className="text-sm text-neutral-500">No accounts configured yet.</p>
                <p className="text-xs text-neutral-600 mt-1">Click &quot;Add Account&quot; to get started with horizontal scaling.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {accounts.map((account) => {
                  const sc = statusConfig[account.status] || statusConfig.DISABLED;
                  const isEditing = editingId === account.id;
                  const cooldownRemaining = account.cooldownUntil
                    ? Math.max(0, Math.ceil((new Date(account.cooldownUntil).getTime() - Date.now()) / 1000 / 60))
                    : 0;

                  return (
                    <div key={account.id} className={`rounded-xl border p-4 transition-all ${sc.bg} ${sc.border}`}>
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Friendly name"
                              className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none" />
                            <input type="text" value={editAccountId} onChange={(e) => setEditAccountId(e.target.value)} placeholder="Account ID"
                              className="rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none" />
                          </div>
                          <input type="url" value={editDsn} onChange={(e) => setEditDsn(e.target.value)} placeholder="DSN Endpoint"
                            className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none" />
                          <input type="text" value={editApiKey} onChange={(e) => setEditApiKey(e.target.value)} placeholder="API Key (leave masked to keep current)"
                            className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none font-mono" />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white transition-colors">Cancel</button>
                            <button onClick={() => handleSaveEdit(account.id)} className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-all">Save</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-4">
                          <div className="pt-1"><div className={`w-3 h-3 rounded-full ${sc.dot}`} /></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-sm font-semibold text-white truncate">{account.name || account.accountId}</h3>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full ${sc.bg} ${sc.color} font-medium uppercase tracking-wider border ${sc.border}`}>{sc.label}</span>
                            </div>
                            <p className="text-xs text-neutral-500 font-mono truncate mb-2">ID: {account.accountId}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
                              <span>DSN: <span className="text-neutral-400">{account.dsn}</span></span>
                              <span>Key: <span className="text-neutral-400 font-mono">{account.apiKey.length > 14 ? `••••••••${account.apiKey.slice(-4)}` : account.apiKey}</span></span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500 mt-1">
                              <span>Requests: <span className="text-neutral-300 font-mono">{account.requestCount}</span></span>
                              <span>Today: <span className="text-neutral-300 font-mono">{account.dailyCount}</span></span>
                              {account.lastUsedAt && <span>Last used: <span className="text-neutral-400">{new Date(account.lastUsedAt).toLocaleTimeString()}</span></span>}
                              {cooldownRemaining > 0 && <span className="text-orange-400">Cooldown: {cooldownRemaining}m remaining</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => handleToggleStatus(account.id, account.status)}
                              className={`p-2 rounded-lg transition-colors ${account.status === "DISABLED" ? "text-emerald-400 hover:bg-emerald-500/10" : "text-neutral-500 hover:bg-neutral-800"}`}
                              title={account.status === "DISABLED" ? "Enable" : "Disable"}>
                              {account.status === "DISABLED"
                                ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>}
                            </button>
                            <button onClick={() => startEditing(account)} className="p-2 rounded-lg text-neutral-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors" title="Edit">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button onClick={() => handleDeleteAccount(account.id)} disabled={account.status === "BUSY"}
                              className="p-2 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Delete">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Info Card */}
          <section className="glassmorphism rounded-2xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Profile Data Source
            </h3>
            <div className="text-xs text-neutral-400 space-y-2 leading-relaxed">
              <p>The evaluator securely connects to <strong className="text-neutral-200">Unipile</strong> to retrieve the necessary LinkedIn profile data for analysis.</p>
              <p>Please enter your Unipile account credentials above to enable seamless candidate syncing.</p>
            </div>
          </section>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          TAB 2: MODELS CONFIGURATION
          ═══════════════════════════════════════════════════════════════ */}
      {activeTab === "models" && (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{aiProviders.length}</p>
              <p className="text-xs text-neutral-500 mt-1">Providers</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-indigo-400">{aiProviders.reduce((sum, p) => sum + (p.models?.length || 0), 0)}</p>
              <p className="text-xs text-neutral-500 mt-1">Total Models</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{aiProviders.find((p) => p.isDefault)?.name || "Env Key"}</p>
              <p className="text-xs text-neutral-500 mt-1">Default Provider</p>
            </div>
          </div>

          {/* Providers Section */}
          <section className="glassmorphism rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                AI Providers
              </h2>
              <button
                onClick={() => { setShowAddProvider(!showAddProvider); setEditingProviderId(null); }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Provider
              </button>
            </div>

            {/* ── Add Provider Form ── */}
            {showAddProvider && (
              <form onSubmit={handleAddProvider} className="space-y-5 p-5 rounded-xl bg-neutral-950/50 border border-neutral-800 mb-6">
                <h3 className="text-sm font-semibold text-white">New AI Provider</h3>

                {/* Provider + Name row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Provider <span className="text-rose-400">*</span></label>
                    <select
                      value={selectedPreset}
                      onChange={(e) => handlePresetChange(e.target.value)}
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                    >
                      {Object.entries(PROVIDER_PRESETS).map(([key, p]) => (
                        <option key={key} value={key}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Display Name <span className="text-rose-400">*</span></label>
                    <input
                      type="text"
                      value={newProviderName}
                      onChange={(e) => setNewProviderName(e.target.value)}
                      placeholder="e.g., My OpenAI"
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                {/* Bedrock: Region selector | Custom: URL + API format | Others: read-only URL */}
                {selectedPreset === "bedrock" ? (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">AWS Region <span className="text-rose-400">*</span></label>
                    <select
                      value={newProviderCustomBaseUrl}
                      onChange={(e) => setNewProviderCustomBaseUrl(e.target.value)}
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                    >
                      {BEDROCK_REGIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label} ({r.value})</option>
                      ))}
                    </select>
                  </div>
                ) : selectedPreset === "custom" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-400">Base URL <span className="text-rose-400">*</span></label>
                      <input
                        type="url"
                        value={newProviderCustomBaseUrl}
                        onChange={(e) => setNewProviderCustomBaseUrl(e.target.value)}
                        placeholder="https://your-api-endpoint.com/v1"
                        className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-neutral-400">API Format <span className="text-rose-400">*</span></label>
                      <select
                        value={newProviderCustomType}
                        onChange={(e) => setNewProviderCustomType(e.target.value)}
                        className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                      >
                        <option value="openai-compatible">OpenAI-Compatible</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Base URL <span className="text-neutral-600">(auto-filled)</span></label>
                    <div className="w-full rounded-lg bg-neutral-950/50 border border-neutral-800 px-3 py-2.5 text-sm text-neutral-500 font-mono truncate">
                      {currentPreset.baseUrl}
                    </div>
                  </div>
                )}


                {/* Credentials — Bedrock gets two fields; all others get one */}
                {selectedPreset === "bedrock" ? (
                  <>
                    <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-400">
                      IAM credentials need <code className="font-mono">bedrock:InvokeModel</code> and <code className="font-mono">bedrock:Converse</code> permissions. Model access must also be enabled in the AWS console.
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-neutral-400">Access Key ID <span className="text-rose-400">*</span></label>
                        <input
                          type="text"
                          value={newProviderApiKey}
                          onChange={(e) => setNewProviderApiKey(e.target.value)}
                          placeholder="AKIAIOSFODNN7EXAMPLE"
                          className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-neutral-400">Secret Access Key <span className="text-rose-400">*</span></label>
                        <input
                          type="password"
                          value={newProviderSecretKey}
                          onChange={(e) => setNewProviderSecretKey(e.target.value)}
                          placeholder="wJalrXUtnFEMI/K7MDENG/..."
                          className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors font-mono"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">API Key <span className="text-rose-400">*</span></label>
                    <input
                      type="password"
                      value={newProviderApiKey}
                      onChange={(e) => setNewProviderApiKey(e.target.value)}
                      placeholder="Your API key"
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors font-mono"
                    />
                  </div>
                )}

                {/* Models — checkboxes for known presets */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-neutral-400">Models <span className="text-rose-400">*</span></label>

                  {currentPreset.suggestedModels.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {currentPreset.suggestedModels.map(model => (
                        <button
                          key={model}
                          type="button"
                          onClick={() => toggleNewModel(model)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium border transition-all ${
                            newSelectedModels.includes(model)
                              ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                              : "bg-neutral-900/40 border-neutral-700/50 text-neutral-500 hover:border-neutral-600 hover:text-neutral-300"
                          }`}
                        >
                          {newSelectedModels.includes(model) ? "✓ " : ""}{model}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Add custom model */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCustomModelInput}
                      onChange={(e) => setNewCustomModelInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewCustomModel(); } }}
                      placeholder={currentPreset.suggestedModels.length > 0 ? "Add another model ID..." : "Enter model ID (e.g. gpt-4o)"}
                      className="flex-1 rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none font-mono"
                    />
                    <button type="button" onClick={addNewCustomModel} disabled={!newCustomModelInput.trim()}
                      className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors disabled:opacity-40">
                      Add
                    </button>
                  </div>

                  {/* Selected models tags */}
                  {newSelectedModels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] text-neutral-600 self-center">Selected:</span>
                      {newSelectedModels.map(m => (
                        <span key={m} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[11px] text-indigo-300 font-mono">
                          {m}
                          <button type="button" onClick={() => setNewSelectedModels(prev => prev.filter(x => x !== m))}
                            className="text-indigo-400/60 hover:text-indigo-300 transition-colors">×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Test result */}
                {providerTestResult && (
                  <div className={`rounded-lg p-3 border text-sm ${providerTestResult.success ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"}`}>
                    <div className="flex items-center gap-2">
                      {providerTestResult.success
                        ? <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>}
                      <span>{providerTestResult.message}</span>
                    </div>
                  </div>
                )}
                {providerFormError && <p className="text-sm text-rose-400">{providerFormError}</p>}

                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={handleTestNewProvider}
                    disabled={providerTestLoading || !newProviderApiKey || newSelectedModels.length === 0}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    {providerTestLoading
                      ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Testing...</>
                      : <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test Connection</>}
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => { setShowAddProvider(false); setProviderTestResult(null); setProviderFormError(null); }}
                      className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:text-white transition-colors">Cancel</button>
                    <button type="submit"
                      disabled={providerSubmitting || !newProviderName || newSelectedModels.length === 0 || !newProviderApiKey || (selectedPreset === "custom" && !newProviderCustomBaseUrl)}
                      className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                      {providerSubmitting ? "Saving..." : "Save Provider"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* ── Provider List ── */}
            {providersLoading ? (
              <div className="space-y-3 animate-pulse">{[...Array(2)].map((_, i) => <div key={i} className="h-24 bg-neutral-800/50 rounded-xl" />)}</div>
            ) : aiProviders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-700/50 p-8 text-center">
                <svg className="w-12 h-12 text-neutral-700 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <p className="text-sm text-neutral-500">No AI providers configured yet.</p>
                <p className="text-xs text-neutral-600 mt-1">
                  Using <span className="text-neutral-400">OPENAI_API_KEY</span> from environment by default. Add providers for Gemini, Claude, Groq, and more.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {aiProviders.map((provider) => {
                  const isEditing = editingProviderId === provider.id;
                  const quickResult = quickTestResults[provider.id];

                  return (
                    <div key={provider.id} onClick={!provider.isDefault && !isEditing ? () => handleSetDefault(provider.id) : undefined} className={`rounded-xl border p-4 transition-all ${provider.isDefault ? "bg-indigo-500/5 border-indigo-500/30" : `bg-neutral-500/5 border-neutral-700/50 ${!isEditing ? "cursor-pointer hover:border-indigo-500/20 hover:bg-indigo-500/5" : ""}`}`}>
                      {isEditing ? (
                        /* ── Inline Edit Form ── */
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-neutral-300">Edit Provider</span>
                            <button onClick={() => { setEditingProviderId(null); setEditTestResult(null); }}
                              className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">Cancel</button>
                          </div>

                          <div className={`grid grid-cols-1 ${provider.provider === "bedrock" ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-3`}>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-neutral-500">Name</label>
                              <input type="text" value={editProviderName} onChange={(e) => setEditProviderName(e.target.value)}
                                className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-neutral-500">
                                {provider.provider === "bedrock" ? "Access Key ID" : "API Key"} <span className="text-neutral-600">(leave masked to keep)</span>
                              </label>
                              <input type="text" value={editProviderApiKey} onChange={(e) => setEditProviderApiKey(e.target.value)}
                                className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none font-mono" />
                            </div>
                            {provider.provider === "bedrock" && (
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-neutral-500">Secret Access Key <span className="text-neutral-600">(leave masked)</span></label>
                                <input type="password" value={editProviderSecretKey} onChange={(e) => setEditProviderSecretKey(e.target.value)}
                                  className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-sm text-neutral-200 focus:border-indigo-500 focus:outline-none font-mono" />
                              </div>
                            )}
                          </div>

                          {/* Models tag editor */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-neutral-500">Models</label>
                            <div className="flex flex-wrap gap-1.5">
                              {editSelectedModels.map(m => (
                                <span key={m} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[11px] text-indigo-300 font-mono">
                                  {m}
                                  <button type="button" onClick={() => toggleEditModel(m)}
                                    className="text-indigo-400/60 hover:text-indigo-300 transition-colors">×</button>
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <input type="text" value={editCustomModelInput} onChange={(e) => setEditCustomModelInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEditCustomModel(); } }}
                                placeholder="Add model ID..."
                                className="flex-1 rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:outline-none font-mono" />
                              <button type="button" onClick={addEditCustomModel} disabled={!editCustomModelInput.trim()}
                                className="px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors disabled:opacity-40">Add</button>
                            </div>
                          </div>

                          {editTestResult && (
                            <div className={`rounded-lg p-2.5 border text-xs ${editTestResult.success ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"}`}>
                              {editTestResult.success ? "✓ " : "✗ "}{editTestResult.message}
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1">
                            <button type="button" onClick={() => handleTestEditProvider(provider)}
                              disabled={editTestLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 border border-neutral-700 text-xs font-medium text-neutral-300 hover:bg-neutral-700 transition-all disabled:opacity-40">
                              {editTestLoading
                                ? <><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Testing...</>
                                : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test</>}
                            </button>
                            <button onClick={() => handleSaveEditProvider(provider.id)}
                              disabled={editSubmitting || editSelectedModels.length === 0 || !editProviderName}
                              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 transition-all disabled:opacity-40 active:scale-95">
                              {editSubmitting ? "Saving..." : "Save Changes"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Provider Card ── */
                        <div className="flex items-start gap-4">
                          <div className="pt-1">
                            <div className={`w-3 h-3 rounded-full ${provider.isDefault ? "bg-indigo-400" : "bg-neutral-500"}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <h3 className="text-sm font-semibold text-white truncate">{provider.name}</h3>
                              {provider.isDefault && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-medium uppercase tracking-wider border border-indigo-500/30">Default</span>
                              )}
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-500/10 text-neutral-400 font-medium border border-neutral-700/50">
                                {providerTypeLabels[provider.provider] || provider.provider}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {(provider.models || []).map(m => (
                                <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono border border-neutral-700/50">{m}</span>
                              ))}
                            </div>
                            {quickResult && (
                              <p className={`text-[11px] mt-2 ${quickResult.success ? "text-emerald-400" : "text-rose-400"}`}>
                                {quickResult.success ? "✓ " : "✗ "}{quickResult.message}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Quick Test */}
                            <button onClick={() => handleQuickTest(provider)}
                              disabled={quickTestId === provider.id}
                              className="p-2 rounded-lg text-neutral-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40" title="Test connection">
                              {quickTestId === provider.id
                                ? <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                            </button>
                            {/* Edit */}
                            <button onClick={() => { startEditProvider(provider); setShowAddProvider(false); }}
                              className="p-2 rounded-lg text-neutral-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors" title="Edit provider">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            {/* Delete */}
                            <button onClick={() => handleDeleteProvider(provider.id)}
                              className="p-2 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors" title="Delete">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Info Card */}
          <section className="glassmorphism rounded-2xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              How It Works
            </h3>
            <div className="text-xs text-neutral-400 space-y-2 leading-relaxed">
              <p>Add any AI provider that supports the <strong className="text-neutral-200">OpenAI-compatible</strong> API format (most do: Gemini, Groq, Together, Mistral, DeepSeek, Ollama) or <strong className="text-neutral-200">Anthropic&apos;s</strong> Messages API.</p>
              <p>Once added, providers and their models appear in the job creation form for selection. The <strong className="text-neutral-200">default</strong> provider is used when no specific provider is chosen.</p>
              <p>If no providers are configured, the system falls back to the <code className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">OPENAI_API_KEY</code> environment variable.</p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

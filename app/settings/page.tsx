"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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
  baseUrl: string;
  apiKey: string;
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
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: "", provider: "openai-compatible", baseUrl: "", apiKey: "", models: "" });
  const [providerTestResult, setProviderTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [providerTestLoading, setProviderTestLoading] = useState(false);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [providerSubmitting, setProviderSubmitting] = useState(false);

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

  // ── AI Provider Handlers ──

  async function handleTestProvider() {
    setProviderTestLoading(true);
    setProviderTestResult(null);
    try {
      const models = newProvider.models.split(",").map((m) => m.trim()).filter(Boolean);
      const res = await fetch("/api/ai-providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: newProvider.provider,
          baseUrl: newProvider.baseUrl,
          apiKey: newProvider.apiKey,
          model: models[0],
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
    const models = newProvider.models.split(",").map((m) => m.trim()).filter(Boolean);
    if (!newProvider.name || !newProvider.baseUrl || !newProvider.apiKey || models.length === 0) return;
    setProviderSubmitting(true);
    setProviderFormError(null);
    try {
      const res = await fetch("/api/ai-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newProvider, models, isDefault: aiProviders.length === 0 }),
      });
      if (!res.ok) { const data = await res.json(); setProviderFormError(data.error || "Failed to add provider"); return; }
      setNewProvider({ name: "", provider: "openai-compatible", baseUrl: "", apiKey: "", models: "" });
      setShowAddProvider(false);
      setProviderTestResult(null);
      fetchProviders();
    } catch { setProviderFormError("Network error"); } finally { setProviderSubmitting(false); }
  }

  async function handleDeleteProvider(id: string) {
    if (!confirm("Remove this AI provider?")) return;
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
    ACTIVE: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400", label: "Active" },
    BUSY: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-400 animate-pulse", label: "Processing" },
    COOLDOWN: { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30", dot: "bg-orange-400", label: "Cooldown" },
    DISABLED: { color: "text-neutral-400", bg: "bg-neutral-500/10", border: "border-neutral-500/30", dot: "bg-neutral-500", label: "Disabled" },
  };

  const activeCount = accounts.filter((a) => a.status === "ACTIVE" || a.status === "BUSY").length;

  const providerTypeLabels: Record<string, string> = {
    "openai-compatible": "OpenAI-Compatible",
    "anthropic": "Anthropic (Claude)",
  };

  return (
    <main className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-neutral-400 hover:text-white transition-colors"
          >
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
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === "accounts"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-neutral-400 hover:text-white hover:bg-neutral-800"
          }`}
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
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === "models"
              ? "bg-indigo-600 text-white shadow-sm"
              : "text-neutral-400 hover:text-white hover:bg-neutral-800"
          }`}
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
              <p className="text-2xl font-bold text-amber-400">
                {accounts.filter((a) => a.status === "BUSY").length}
              </p>
              <p className="text-xs text-neutral-500 mt-1">Processing</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-orange-400">
                {accounts.filter((a) => a.status === "COOLDOWN").length}
              </p>
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
              <form
                onSubmit={handleAddAccount}
                className="space-y-4 p-5 rounded-xl bg-neutral-950/50 border border-neutral-800 mb-6"
              >
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
                      {testResult.success ? (
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span>{testResult.message || testResult.error}</span>
                    </div>
                  </div>
                )}
                {formError && <p className="text-sm text-rose-400">{formError}</p>}

                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={handleTestConnection}
                    disabled={testing || !formDsn || !formApiKey || !formAccountId}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    {testing ? (
                      <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Testing...</>
                    ) : (
                      <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test Connection</>
                    )}
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
              <div className="space-y-3 animate-pulse">
                {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-neutral-800/50 rounded-xl" />)}
              </div>
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
                              <span>Key: <span className="text-neutral-400 font-mono" title={account.apiKey}>{account.apiKey.length > 14 ? `••••••••${account.apiKey.slice(-4)}` : account.apiKey}</span></span>
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
                              {account.status === "DISABLED" ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                              )}
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
              <p className="text-2xl font-bold text-indigo-400">
                {aiProviders.reduce((sum, p) => sum + (p.models?.length || 0), 0)}
              </p>
              <p className="text-xs text-neutral-500 mt-1">Total Models</p>
            </div>
            <div className="glassmorphism rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">
                {aiProviders.find((p) => p.isDefault)?.name || "Env Key"}
              </p>
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
                onClick={() => setShowAddProvider(!showAddProvider)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Provider
              </button>
            </div>

            {/* Add Provider Form */}
            {showAddProvider && (
              <form onSubmit={handleAddProvider} className="space-y-4 p-5 rounded-xl bg-neutral-950/50 border border-neutral-800 mb-6">
                <h3 className="text-sm font-semibold text-white">New AI Provider</h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Provider Name <span className="text-rose-400">*</span></label>
                    <input type="text" value={newProvider.name} onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })}
                      placeholder="e.g., My Gemini, Claude Prod"
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-neutral-400">Provider Type <span className="text-rose-400">*</span></label>
                    <select value={newProvider.provider} onChange={(e) => setNewProvider({ ...newProvider, provider: e.target.value })}
                      className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors">
                      <option value="openai-compatible">OpenAI-Compatible (OpenAI, Gemini, Groq, Together, Mistral, Ollama...)</option>
                      <option value="anthropic">Anthropic (Claude)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-400">Base URL <span className="text-rose-400">*</span></label>
                  <input type="url" value={newProvider.baseUrl} onChange={(e) => setNewProvider({ ...newProvider, baseUrl: e.target.value })}
                    placeholder={newProvider.provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://generativelanguage.googleapis.com/v1beta/openai"}
                    className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                  <p className="text-[11px] text-neutral-600">
                    {newProvider.provider === "anthropic"
                      ? "Usually https://api.anthropic.com/v1"
                      : "OpenAI: https://api.openai.com/v1 | Gemini: https://generativelanguage.googleapis.com/v1beta/openai | Groq: https://api.groq.com/openai/v1"}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-400">API Key <span className="text-rose-400">*</span></label>
                  <input type="password" value={newProvider.apiKey} onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                    placeholder="Your API key"
                    className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors font-mono" />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-neutral-400">Model Names <span className="text-rose-400">*</span></label>
                  <input type="text" value={newProvider.models} onChange={(e) => setNewProvider({ ...newProvider, models: e.target.value })}
                    placeholder="Comma-separated, e.g. gemini-2.5-flash, gemini-2.0-pro"
                    className="w-full rounded-lg bg-neutral-900/50 border border-neutral-700 px-3 py-2.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors" />
                  <p className="text-[11px] text-neutral-600">Enter the exact model IDs supported by this provider.</p>
                </div>

                {providerTestResult && (
                  <div className={`rounded-lg p-3 border text-sm ${providerTestResult.success ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"}`}>
                    <div className="flex items-center gap-2">
                      {providerTestResult.success ? (
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      )}
                      <span>{providerTestResult.message}</span>
                    </div>
                  </div>
                )}
                {providerFormError && <p className="text-sm text-rose-400">{providerFormError}</p>}

                <div className="flex items-center justify-between pt-2">
                  <button type="button" onClick={handleTestProvider}
                    disabled={providerTestLoading || !newProvider.baseUrl || !newProvider.apiKey || !newProvider.models}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                    {providerTestLoading ? (
                      <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>Testing...</>
                    ) : (
                      <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test Connection</>
                    )}
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => { setShowAddProvider(false); setProviderTestResult(null); setProviderFormError(null); }}
                      className="px-4 py-2 rounded-lg text-sm text-neutral-400 hover:text-white transition-colors">Cancel</button>
                    <button type="submit"
                      disabled={providerSubmitting || !newProvider.name || !newProvider.baseUrl || !newProvider.apiKey || !newProvider.models}
                      className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
                      {providerSubmitting ? "Saving..." : "Save Provider"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Provider List */}
            {providersLoading ? (
              <div className="space-y-3 animate-pulse">
                {[...Array(2)].map((_, i) => <div key={i} className="h-24 bg-neutral-800/50 rounded-xl" />)}
              </div>
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
                {aiProviders.map((provider) => (
                  <div key={provider.id} className={`rounded-xl border p-4 transition-all ${provider.isDefault ? "bg-indigo-500/5 border-indigo-500/30" : "bg-neutral-500/5 border-neutral-700/50"}`}>
                    <div className="flex items-start gap-4">
                      <div className="pt-1">
                        <div className={`w-3 h-3 rounded-full ${provider.isDefault ? "bg-indigo-400" : "bg-neutral-500"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-semibold text-white truncate">{provider.name}</h3>
                          {provider.isDefault && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 font-medium uppercase tracking-wider border border-indigo-500/30">Default</span>
                          )}
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-500/10 text-neutral-400 font-medium border border-neutral-700/50">
                            {providerTypeLabels[provider.provider] || provider.provider}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 truncate mb-2">{provider.baseUrl}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
                          <span>Key: <span className="text-neutral-400 font-mono">{provider.apiKey}</span></span>
                          <span>Models: <span className="text-neutral-300">{(provider.models || []).join(", ")}</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!provider.isDefault && (
                          <button onClick={() => handleSetDefault(provider.id)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 border border-neutral-700/50 hover:border-indigo-500/30 transition-colors"
                            title="Set as default">
                            Set Default
                          </button>
                        )}
                        <button onClick={() => handleDeleteProvider(provider.id)}
                          className="p-2 rounded-lg text-neutral-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors" title="Delete">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
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

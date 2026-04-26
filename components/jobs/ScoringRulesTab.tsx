"use client";

import { useState } from "react";
import {
  DEFAULT_RULE_PROMPTS,
  DEFAULT_RULE_DEFINITIONS,
  DEFAULT_PROMPT_ENVELOPE,
} from "@/lib/analyzer";
import type { ScoreParameter, PromptEnvelope, RuleDefinition } from "@/lib/analyzer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ChevronDown, Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SCORING_RULE_DEFS = [
  { key: "stability",    label: "Stability",    max: 10, tiers: [
    { score: 10, color: "text-emerald-600 dark:text-emerald-400", text: "Avg tenure > 2.5 years" },
    { score: 7,  color: "text-amber-600 dark:text-amber-400",     text: "Avg tenure 1.5 – 2.5 years" },
    { score: 0,  color: "text-rose-600 dark:text-rose-400",       text: "Avg tenure < 1.5 years" },
  ]},
  { key: "growth",       label: "Growth",       max: 15, tiers: [
    { score: 15, color: "text-emerald-600 dark:text-emerald-400", text: "Internal promotion (higher role, same company)" },
    { score: 10, color: "text-amber-600 dark:text-amber-400",     text: "External growth (higher role, new company)" },
    { score: 0,  color: "text-rose-600 dark:text-rose-400",       text: "No upward career movement detected" },
  ]},
  { key: "graduation",   label: "Graduation",   max: 15, tiers: [
    { score: 15, color: "text-emerald-600 dark:text-emerald-400", text: "BTech/BE from Tier 1 institution" },
    { score: 10, color: "text-amber-600 dark:text-amber-400",     text: "BTech/BE from Tier 2 institution" },
    { score: 7,  color: "text-amber-600 dark:text-amber-400",     text: "Non-BTech from Tier 1 institution" },
    { score: 5,  color: "text-amber-600 dark:text-amber-400",     text: "Non-BTech from Tier 2 institution" },
    { score: 0,  color: "text-rose-600 dark:text-rose-400",       text: "Unranked institution or no degree info" },
  ]},
  { key: "companyType",  label: "Company Type", max: 15, tiers: [
    { score: 15, color: "text-emerald-600 dark:text-emerald-400", text: "B2B Sales/CRM/SalesTech product company" },
    { score: 10, color: "text-amber-600 dark:text-amber-400",     text: "B2B SaaS non-CRM (cloud, infra, HR tech, etc.)" },
    { score: 7,  color: "text-amber-600 dark:text-amber-400",     text: "Service-based / IT consulting company" },
    { score: 0,  color: "text-rose-600 dark:text-rose-400",       text: "B2C or unrelated company" },
  ]},
  { key: "mba",          label: "MBA",          max: 15, tiers: [
    { score: 15, color: "text-emerald-600 dark:text-emerald-400", text: "MBA/PGDM from Tier 1 institution" },
    { score: 10, color: "text-amber-600 dark:text-amber-400",     text: "MBA/PGDM from other institution" },
    { score: 0,  color: "text-rose-600 dark:text-rose-400",       text: "No MBA/PGDM" },
  ]},
  { key: "skillMatch",   label: "Skill Match",  max: 10, tiers: [
    { score: 10, color: "text-emerald-600 dark:text-emerald-400", text: ">70% of JD-required skills matched" },
    { score: 5,  color: "text-amber-600 dark:text-amber-400",     text: "40–70% of JD-required skills matched" },
    { score: 0,  color: "text-rose-600 dark:text-rose-400",       text: "<40% of JD-required skills matched" },
  ]},
  { key: "location",     label: "Location",     max: 5, tiers: [
    { score: 5, color: "text-emerald-600 dark:text-emerald-400",  text: "Candidate location matches JD location" },
    { score: 0, color: "text-rose-600 dark:text-rose-400",        text: "Location does not match" },
  ]},
];

const DEFAULT_SCORING_RULES = {
  stability: true, growth: true, graduation: true, companyType: true,
  mba: true, skillMatch: true, location: true,
};

const RULE_MAX: Record<string, number> = {
  stability: 10, growth: 15, graduation: 15, companyType: 15,
  mba: 15, skillMatch: 10, location: 5,
};

interface CustomRule {
  id: string;
  name: string;
  maxPoints: number;
  criteria: string;
  enabled: boolean;
}

interface Props {
  requisitionId: string;
  initialConfig: any;
  onSaved?: () => void;
}

const ENVELOPE_FIELDS: { key: keyof PromptEnvelope; label: string; tokens?: string; rows: number }[] = [
  { key: "identityTemplate", label: "Identity line", tokens: "Tokens: {role}, {today}", rows: 3 },
  { key: "defaultRole", label: "Default evaluator role (used when no custom role is set)", rows: 2 },
  { key: "guidelinesSectionHeader", label: "Guidelines section header", rows: 1 },
  { key: "recruiterContextHeader", label: "Recruiter context header", rows: 1 },
  { key: "scoringSectionHeader", label: "Scoring rules section header", rows: 1 },
  { key: "responseSchemaTemplate", label: "JSON response schema + footer", tokens: "Tokens: {scoringFields}, {scoringLogsFields}", rows: 14 },
];

export function ScoringRulesTab({ requisitionId, initialConfig, onSaved }: Props) {
  const cfg = initialConfig || {};

  const [scoringRules, setScoringRules] = useState<Record<string, boolean>>({
    ...DEFAULT_SCORING_RULES,
    ...(cfg.scoringRules || {}),
  });
  const [customScoringRules, setCustomScoringRules] = useState<CustomRule[]>(cfg.customScoringRules || []);
  const [builtInRuleDescriptions, setBuiltInRuleDescriptions] = useState<Record<string, string>>(cfg.builtInRuleDescriptions || {});
  const [ruleDefinitions, setRuleDefinitions] = useState<Record<string, Partial<RuleDefinition>>>(cfg.ruleDefinitions || {});
  const [promptEnvelope, setPromptEnvelope] = useState<Partial<PromptEnvelope>>(cfg.promptEnvelope || {});
  const [minScoreThreshold, setMinScoreThreshold] = useState(cfg.minScoreThreshold ?? 70);
  const [autoShortlistThreshold, setAutoShortlistThreshold] = useState(cfg.autoShortlistThreshold ?? 70);

  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null);
  const [expandEnvelope, setExpandEnvelope] = useState(false);
  const [savingDescKey, setSavingDescKey] = useState<string | null>(null);
  const [savedDescKey, setSavedDescKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRuleKey, setSavedRuleKey] = useState<string | null>(null);
  const [savingEnvelope, setSavingEnvelope] = useState(false);
  const [savedEnvelope, setSavedEnvelope] = useState(false);

  // Score parameter inline-edit state per rule (built-in)
  const [editingParam, setEditingParam] = useState<{ ruleKey: string; idx: number } | null>(null);
  const [editParamForm, setEditParamForm] = useState<ScoreParameter>({ key: "", label: "", allowedValuesHint: "", maxPoints: 0 });
  const [addingParam, setAddingParam] = useState<string | null>(null);
  const [newParamForm, setNewParamForm] = useState<ScoreParameter>({ key: "", label: "", allowedValuesHint: "", maxPoints: 10 });

  // Custom rule new/edit state
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleMax, setNewRuleMax] = useState(10);
  const [newRuleCriteria, setNewRuleCriteria] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleForm, setEditRuleForm] = useState<{ name: string; maxPoints: number; criteria: string; logFormat?: string }>({
    name: "", maxPoints: 10, criteria: "",
  });

  async function saveConfig(patch: Record<string, any>): Promise<boolean> {
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveError(data.error || `Save failed (${res.status})`);
        setTimeout(() => setSaveError(null), 4000);
        return false;
      }
      onSaved?.();
      return true;
    } catch {
      setSaveError("Network error — changes not saved");
      setTimeout(() => setSaveError(null), 4000);
      return false;
    }
  }

  // ── Built-in rule toggles ──
  async function toggleBuiltIn(key: string) {
    const next = { ...scoringRules, [key]: !scoringRules[key] };
    setScoringRules(next);
    const ok = await saveConfig({ scoringRules: next });
    if (ok) {
      setSavedRuleKey(key);
      setTimeout(() => setSavedRuleKey(k => (k === key ? null : k)), 1500);
    }
  }

  // ── Description save/reset (legacy builtInRuleDescriptions) ──
  function expandRule(key: string) {
    if (expandedRuleKey === key) { setExpandedRuleKey(null); return; }
    setExpandedRuleKey(key);
    if (!(key in builtInRuleDescriptions) && DEFAULT_RULE_PROMPTS[key]) {
      setBuiltInRuleDescriptions(prev => ({ ...prev, [key]: DEFAULT_RULE_PROMPTS[key] }));
    }
  }

  async function saveDescription(key: string) {
    setSavingDescKey(key);
    const ok = await saveConfig({ builtInRuleDescriptions });
    setSavingDescKey(null);
    if (ok) {
      setSavedDescKey(key);
      setTimeout(() => setSavedDescKey(k => (k === key ? null : k)), 2000);
    }
  }

  async function resetDescription(key: string) {
    const next = { ...builtInRuleDescriptions };
    delete next[key];
    setBuiltInRuleDescriptions(next);
    await saveConfig({ builtInRuleDescriptions: next });
  }

  // ── Score parameters helpers ──
  function getEffectiveParams(ruleKey: string): ScoreParameter[] {
    return ruleDefinitions[ruleKey]?.scoreParameters
      ?? DEFAULT_RULE_DEFINITIONS[ruleKey]?.scoreParameters
      ?? [];
  }

  function getEffectiveLogFormat(ruleKey: string): string {
    return ruleDefinitions[ruleKey]?.logFormat
      ?? DEFAULT_RULE_DEFINITIONS[ruleKey]?.logFormat
      ?? "";
  }

  function hasRuleOverride(ruleKey: string) {
    return !!ruleDefinitions[ruleKey];
  }

  async function saveRuleDef(key: string, patch: Partial<RuleDefinition>) {
    const next = { ...ruleDefinitions, [key]: { ...(ruleDefinitions[key] || {}), ...patch } };
    setRuleDefinitions(next);
    return saveConfig({ ruleDefinitions: next });
  }

  async function resetRuleDef(key: string) {
    const next = { ...ruleDefinitions };
    delete next[key];
    setRuleDefinitions(next);
    await saveConfig({ ruleDefinitions: next });
  }

  function startEditParam(ruleKey: string, idx: number) {
    const params = getEffectiveParams(ruleKey);
    setEditingParam({ ruleKey, idx });
    setEditParamForm({ ...params[idx] });
  }

  async function saveEditParam(ruleKey: string, idx: number) {
    const params = [...getEffectiveParams(ruleKey)];
    params[idx] = { ...editParamForm, maxPoints: Number(editParamForm.maxPoints) || 0 };
    await saveRuleDef(ruleKey, { scoreParameters: params });
    setEditingParam(null);
  }

  async function deleteParam(ruleKey: string, idx: number) {
    const params = getEffectiveParams(ruleKey).filter((_, i) => i !== idx);
    await saveRuleDef(ruleKey, { scoreParameters: params });
  }

  async function addParam(ruleKey: string) {
    if (!newParamForm.key.trim()) return;
    const params = [...getEffectiveParams(ruleKey), { ...newParamForm, maxPoints: Number(newParamForm.maxPoints) || 0 }];
    await saveRuleDef(ruleKey, { scoreParameters: params });
    setNewParamForm({ key: "", label: "", allowedValuesHint: "", maxPoints: 10 });
    setAddingParam(null);
  }

  async function saveLogFormat(ruleKey: string, value: string) {
    await saveRuleDef(ruleKey, { logFormat: value });
  }

  // ── Custom rules ──
  function toggleCustom(id: string) {
    const next = customScoringRules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r);
    setCustomScoringRules(next);
    saveConfig({ customScoringRules: next });
  }

  function deleteCustom(id: string) {
    const next = customScoringRules.filter(r => r.id !== id);
    const nextDefs = { ...ruleDefinitions };
    delete nextDefs[id];
    setCustomScoringRules(next);
    setRuleDefinitions(nextDefs);
    saveConfig({ customScoringRules: next, ruleDefinitions: nextDefs });
    if (editingRuleId === id) setEditingRuleId(null);
  }

  function startEditRule(rule: CustomRule) {
    setEditingRuleId(rule.id);
    setEditRuleForm({
      name: rule.name,
      maxPoints: rule.maxPoints,
      criteria: rule.criteria,
      logFormat: ruleDefinitions[rule.id]?.logFormat ?? `<1-2 sentence: evidence and reasoning for ${rule.name} score>`,
    });
  }

  async function saveEditRule(id: string) {
    const next = customScoringRules.map(r =>
      r.id === id ? { ...r, name: editRuleForm.name, maxPoints: Number(editRuleForm.maxPoints) || r.maxPoints, criteria: editRuleForm.criteria } : r
    );
    setCustomScoringRules(next);
    await saveConfig({ customScoringRules: next });
    if (editRuleForm.logFormat !== undefined) {
      await saveRuleDef(id, { logFormat: editRuleForm.logFormat });
    }
    setEditingRuleId(null);
  }

  function addCustom() {
    if (!newRuleName.trim() || !newRuleCriteria.trim()) return;
    const next = [...customScoringRules, {
      id: `cr_${Date.now()}`,
      name: newRuleName.trim(),
      maxPoints: newRuleMax,
      criteria: newRuleCriteria.trim(),
      enabled: true,
    }];
    setCustomScoringRules(next);
    saveConfig({ customScoringRules: next });
    setNewRuleName("");
    setNewRuleCriteria("");
    setNewRuleMax(10);
  }

  // ── Prompt Envelope ──
  async function saveEnvelope() {
    setSavingEnvelope(true);
    const ok = await saveConfig({ promptEnvelope });
    setSavingEnvelope(false);
    if (ok) {
      setSavedEnvelope(true);
      setTimeout(() => setSavedEnvelope(false), 2000);
    }
  }

  async function resetEnvelopeField(key: keyof PromptEnvelope) {
    const next = { ...promptEnvelope };
    delete next[key];
    setPromptEnvelope(next);
    await saveConfig({ promptEnvelope: next });
  }

  // ── Totals ──
  const totalMax = Object.entries(scoringRules)
    .filter(([, v]) => v)
    .reduce((sum, [k]) => sum + (RULE_MAX[k] || 0), 0)
    + customScoringRules.filter(r => r.enabled).reduce((s, r) => s + r.maxPoints, 0);

  return (
    <div className="space-y-6 max-w-4xl">
      {saveError && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
          <X className="h-4 w-4 shrink-0" />
          {saveError}
        </div>
      )}

      {/* ── Built-in rules ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Built-in Scoring Rules</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Toggle, edit scoring parameters, log format, and description per rule.</p>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{totalMax} pts max</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {SCORING_RULE_DEFS.map(rule => {
            const enabled = scoringRules[rule.key];
            const isExpanded = expandedRuleKey === rule.key;
            const hasCustomDesc = rule.key in builtInRuleDescriptions;
            const currentDesc = builtInRuleDescriptions[rule.key] ?? DEFAULT_RULE_PROMPTS[rule.key] ?? "";
            const hasDescriptionField = !!DEFAULT_RULE_PROMPTS[rule.key];
            const hasRuleDef = hasRuleOverride(rule.key);
            const effectiveParams = getEffectiveParams(rule.key);
            const effectiveLogFormat = getEffectiveLogFormat(rule.key);
            const isPreComputed = DEFAULT_RULE_DEFINITIONS[rule.key]?.isPreComputed;

            return (
              <div key={rule.key} className={cn("rounded-lg border transition-all", enabled ? "border-border bg-card" : "border-border bg-muted/30 opacity-60")}>
                <div className="flex items-center gap-3 p-3">
                  <Switch checked={enabled} onCheckedChange={() => toggleBuiltIn(rule.key)} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium", enabled ? "text-foreground" : "text-muted-foreground")}>{rule.label}</p>
                    {!isExpanded && enabled && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{rule.tiers[0].text}</p>
                    )}
                  </div>
                  {savedRuleKey === rule.key && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5"><Check className="h-3 w-3" /> Saved</span>
                  )}
                  {(hasCustomDesc || hasRuleDef) && enabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/30">Custom</span>
                  )}
                  <span className="text-xs font-mono text-muted-foreground">/{rule.max}</span>
                  {enabled && (
                    <button onClick={() => expandRule(rule.key)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                    </button>
                  )}
                </div>

                {enabled && !isExpanded && (
                  <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                    {rule.tiers.map((t, i) => (
                      <span key={i} className={cn("text-[10px] px-2 py-0.5 rounded-md bg-muted border border-border font-medium", t.color)}>
                        {t.score} · {t.text}
                      </span>
                    ))}
                  </div>
                )}

                {isExpanded && enabled && (
                  <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border">

                    {/* Score Parameters */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium">Score Parameters</Label>
                        {hasRuleDef && (
                          <Button variant="ghost" size="sm" onClick={() => resetRuleDef(rule.key)} className="h-6 text-[10px] text-muted-foreground hover:text-destructive px-2">
                            Reset rule to default
                          </Button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">JSON field names and allowed values sent in the scoring schema.</p>

                      <div className="space-y-1.5">
                        {effectiveParams.map((param, idx) => {
                          const isEditingThis = editingParam?.ruleKey === rule.key && editingParam.idx === idx;
                          return (
                            <div key={idx} className="rounded-md border border-border bg-muted/30">
                              {isEditingThis ? (
                                <div className="p-2 space-y-2">
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">JSON key</Label>
                                      <Input value={editParamForm.key} onChange={e => setEditParamForm(f => ({ ...f, key: e.target.value }))} className="h-7 text-xs font-mono" />
                                    </div>
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Label</Label>
                                      <Input value={editParamForm.label} onChange={e => setEditParamForm(f => ({ ...f, label: e.target.value }))} className="h-7 text-xs" />
                                    </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Allowed values hint</Label>
                                      <Input value={editParamForm.allowedValuesHint} onChange={e => setEditParamForm(f => ({ ...f, allowedValuesHint: e.target.value }))} className="h-7 text-xs font-mono" placeholder={'<15 or "">'} />
                                    </div>
                                    <div>
                                      <Label className="text-[10px] text-muted-foreground">Max points</Label>
                                      <Input type="number" value={editParamForm.maxPoints} onChange={e => setEditParamForm(f => ({ ...f, maxPoints: parseInt(e.target.value) || 0 }))} className="h-7 text-xs text-center" />
                                    </div>
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingParam(null)}>Cancel</Button>
                                    <Button size="sm" className="h-6 text-xs" onClick={() => saveEditParam(rule.key, idx)} disabled={!editParamForm.key.trim()}>Save</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 px-2.5 py-1.5">
                                  <code className="text-[11px] text-primary font-mono flex-1 min-w-0 truncate">&quot;{param.key}&quot;: {param.allowedValuesHint}</code>
                                  <span className="text-[10px] text-muted-foreground shrink-0">/{param.maxPoints}</span>
                                  <button onClick={() => startEditParam(rule.key, idx)} className="p-0.5 rounded text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
                                  {!isPreComputed && (
                                    <button onClick={() => deleteParam(rule.key, idx)} className="p-0.5 rounded text-muted-foreground hover:text-destructive"><Trash2 className="h-3 w-3" /></button>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {!isPreComputed && (
                        addingParam === rule.key ? (
                          <div className="rounded-md border border-dashed border-border p-2 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-[10px] text-muted-foreground">JSON key</Label>
                                <Input value={newParamForm.key} onChange={e => setNewParamForm(f => ({ ...f, key: e.target.value }))} className="h-7 text-xs font-mono" placeholder="myScore" />
                              </div>
                              <div>
                                <Label className="text-[10px] text-muted-foreground">Label</Label>
                                <Input value={newParamForm.label} onChange={e => setNewParamForm(f => ({ ...f, label: e.target.value }))} className="h-7 text-xs" placeholder="My Score" />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-[10px] text-muted-foreground">Allowed values hint</Label>
                                <Input value={newParamForm.allowedValuesHint} onChange={e => setNewParamForm(f => ({ ...f, allowedValuesHint: e.target.value }))} className="h-7 text-xs font-mono" placeholder={'<10 or "">'} />
                              </div>
                              <div>
                                <Label className="text-[10px] text-muted-foreground">Max points</Label>
                                <Input type="number" value={newParamForm.maxPoints} onChange={e => setNewParamForm(f => ({ ...f, maxPoints: parseInt(e.target.value) || 0 }))} className="h-7 text-xs text-center" />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => { setAddingParam(null); setNewParamForm({ key: "", label: "", allowedValuesHint: "", maxPoints: 10 }); }}>Cancel</Button>
                              <Button size="sm" className="h-6 text-xs gap-1" onClick={() => addParam(rule.key)} disabled={!newParamForm.key.trim()}>
                                <Plus className="h-3 w-3" /> Add
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 w-full" onClick={() => setAddingParam(rule.key)}>
                            <Plus className="h-3 w-3" /> Add parameter
                          </Button>
                        )
                      )}
                    </div>

                    {/* Log Format */}
                    {!isPreComputed && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Log Format</Label>
                          {ruleDefinitions[rule.key]?.logFormat !== undefined && (
                            <Button variant="ghost" size="sm" onClick={() => saveLogFormat(rule.key, DEFAULT_RULE_DEFINITIONS[rule.key]?.logFormat ?? "")} className="h-6 text-[10px] text-muted-foreground hover:text-destructive px-2">Reset</Button>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Instruction rendered inside the scoringLogs JSON for this rule.</p>
                        <Textarea
                          rows={2}
                          value={effectiveLogFormat}
                          onChange={e => {
                            const next = { ...ruleDefinitions, [rule.key]: { ...(ruleDefinitions[rule.key] || {}), logFormat: e.target.value } };
                            setRuleDefinitions(next);
                          }}
                          onBlur={e => saveLogFormat(rule.key, e.target.value)}
                          className="font-mono text-xs"
                        />
                      </div>
                    )}

                    {/* Description */}
                    {hasDescriptionField && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">
                            AI Prompt Description
                            {hasCustomDesc && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/30">Custom</span>}
                          </Label>
                        </div>
                        <p className="text-[11px] text-muted-foreground">Full scoring rule text sent to the AI for this dimension.</p>
                        <Textarea
                          rows={6}
                          value={currentDesc}
                          onChange={e => setBuiltInRuleDescriptions(prev => ({ ...prev, [rule.key]: e.target.value }))}
                          className="font-mono text-xs"
                        />
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] text-muted-foreground">Overrides the default rule explanation sent to the AI.</p>
                          <div className="flex items-center gap-2">
                            {hasCustomDesc && (
                              <Button variant="ghost" size="sm" onClick={() => resetDescription(rule.key)} className="h-7 text-xs text-muted-foreground hover:text-destructive">Reset to Default</Button>
                            )}
                            <Button size="sm" onClick={() => saveDescription(rule.key)} disabled={savingDescKey === rule.key} className="h-7 text-xs gap-1">
                              {savingDescKey === rule.key ? "Saving…" : savedDescKey === rule.key ? <><Check className="h-3 w-3" /> Saved</> : "Save"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Custom rules ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom Scoring Rules</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Add custom criteria with configurable score parameters and log format.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {customScoringRules.length > 0 && (
            <div className="space-y-2">
              {customScoringRules.map(rule => {
                const isEditing = editingRuleId === rule.id;
                return (
                  <div key={rule.id} className={cn("rounded-lg border transition-all", isEditing ? "border-primary/40 bg-card" : rule.enabled ? "border-border bg-card" : "border-border bg-muted/30 opacity-60")}>
                    <div className="flex items-center gap-3 p-3">
                      <Switch checked={rule.enabled} onCheckedChange={() => toggleCustom(rule.id)} />
                      <div className="flex-1 min-w-0">
                        <p className={cn("text-sm font-medium", rule.enabled ? "text-foreground" : "text-muted-foreground")}>{rule.name}</p>
                        {!isEditing && <p className="text-[11px] text-muted-foreground truncate">{rule.criteria}</p>}
                      </div>
                      <span className="text-xs font-mono text-muted-foreground">/{rule.maxPoints}</span>
                      <button onClick={() => isEditing ? setEditingRuleId(null) : startEditRule(rule)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                        {isEditing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                      </button>
                      <Button variant="ghost" size="sm" onClick={() => deleteCustom(rule.id)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {isEditing && (
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border">
                        <div className="grid grid-cols-[1fr_80px] gap-2">
                          <Input placeholder="Rule name" value={editRuleForm.name} onChange={e => setEditRuleForm(f => ({ ...f, name: e.target.value }))} />
                          <Input type="number" placeholder="Max" value={editRuleForm.maxPoints} onChange={e => setEditRuleForm(f => ({ ...f, maxPoints: parseInt(e.target.value) || 10 }))} className="text-center" />
                        </div>
                        <Textarea rows={2} placeholder="Criteria description…" value={editRuleForm.criteria} onChange={e => setEditRuleForm(f => ({ ...f, criteria: e.target.value }))} />
                        <div>
                          <Label className="text-xs text-muted-foreground">Log format instruction</Label>
                          <Textarea rows={2} placeholder="<1-2 sentence: evidence and reasoning>" value={editRuleForm.logFormat ?? ""} onChange={e => setEditRuleForm(f => ({ ...f, logFormat: e.target.value }))} className="mt-1 font-mono text-xs" />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingRuleId(null)}>Cancel</Button>
                          <Button size="sm" className="h-7 text-xs" onClick={() => saveEditRule(rule.id)} disabled={!editRuleForm.name.trim()}>Save</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs">Add new rule</Label>
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <Input placeholder="Rule name (e.g. Domain experience)" value={newRuleName} onChange={e => setNewRuleName(e.target.value)} />
              <Input type="number" placeholder="Max" value={newRuleMax} onChange={e => setNewRuleMax(parseInt(e.target.value) || 10)} className="text-center" />
            </div>
            <Textarea rows={2} placeholder="Describe the criteria for the AI to evaluate..." value={newRuleCriteria} onChange={e => setNewRuleCriteria(e.target.value)} />
            <Button onClick={addCustom} disabled={!newRuleName.trim() || !newRuleCriteria.trim()} variant="outline" size="sm" className="w-full gap-2">
              <Plus className="h-3.5 w-3.5" /> Add Custom Rule
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Auto-shortlist threshold ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-shortlist Threshold</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Candidates scoring at or above this threshold are automatically moved to <strong>Shortlisted</strong> and fan-out to active outreach channels begins.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Threshold</Label>
            <span className="text-2xl font-bold text-primary font-mono">{autoShortlistThreshold}%</span>
          </div>
          <input
            type="range" min={0} max={100} value={autoShortlistThreshold}
            onChange={e => setAutoShortlistThreshold(parseInt(e.target.value))}
            onMouseUp={e => saveConfig({ autoShortlistThreshold: parseInt((e.target as HTMLInputElement).value) })}
            onTouchEnd={e => saveConfig({ autoShortlistThreshold: parseInt((e.currentTarget as HTMLInputElement).value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Min score threshold (sheet export) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sheet Export Threshold</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Only profiles scoring at or above this threshold are auto-exported to Google Sheets.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Threshold</Label>
            <span className="text-2xl font-bold text-primary font-mono">{minScoreThreshold}%</span>
          </div>
          <input
            type="range" min={0} max={100} value={minScoreThreshold}
            onChange={e => setMinScoreThreshold(parseInt(e.target.value))}
            onMouseUp={e => saveConfig({ minScoreThreshold: parseInt((e.target as HTMLInputElement).value) })}
            onTouchEnd={e => saveConfig({ minScoreThreshold: parseInt((e.currentTarget as HTMLInputElement).value) })}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Advanced Prompt Template ── */}
      <Card>
        <CardHeader>
          <button className="w-full flex items-center justify-between" onClick={() => setExpandEnvelope(v => !v)}>
            <div className="text-left">
              <CardTitle className="text-base">Advanced Prompt Template</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Override every hardcoded section of the evaluation prompt.</p>
            </div>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expandEnvelope && "rotate-180")} />
          </button>
        </CardHeader>
        {expandEnvelope && (
          <CardContent className="space-y-5">
            {ENVELOPE_FIELDS.map(field => {
              const defaultVal = DEFAULT_PROMPT_ENVELOPE[field.key] as string;
              const currentVal = promptEnvelope[field.key] as string | undefined;
              const isCustom = currentVal !== undefined;
              return (
                <div key={field.key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs font-medium">{field.label}</Label>
                      {field.tokens && <p className="text-[10px] text-muted-foreground">{field.tokens}</p>}
                    </div>
                    {isCustom && (
                      <Button variant="ghost" size="sm" onClick={() => resetEnvelopeField(field.key)} className="h-6 text-[10px] text-muted-foreground hover:text-destructive px-2">Reset</Button>
                    )}
                  </div>
                  <Textarea
                    rows={field.rows}
                    value={currentVal ?? defaultVal}
                    onChange={e => setPromptEnvelope(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="font-mono text-xs"
                  />
                  {isCustom && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/30">Custom</span>
                  )}
                </div>
              );
            })}
            <div className="flex justify-end">
              <Button size="sm" className="gap-1" onClick={saveEnvelope} disabled={savingEnvelope}>
                {savingEnvelope ? "Saving…" : savedEnvelope ? <><Check className="h-3 w-3" /> Saved</> : "Save Template"}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

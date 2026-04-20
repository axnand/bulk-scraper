"use client";

import { useState } from "react";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface CampaignFormValues {
  name: string;
  channel: string;
  threshold: { minScorePercent: number };
  approvalMode: string;
  dailyCap: number;
  sendingAccountId: string;
  status: string;
  template: { body: string; inviteNote?: string; subject?: string };
}

interface Account {
  id: string;
  accountId: string;
  name: string;
}

interface Props {
  accounts: Account[];
  initialValues?: CampaignFormValues;
  onSubmit: (values: CampaignFormValues) => Promise<void>;
  submitLabel?: string;
}

const VARIABLES = ["{{firstName}}", "{{name}}", "{{company}}", "{{role}}", "{{score}}"];

const DEFAULT_INVITE = "Hi {{firstName}}, I came across your profile and think you'd be a great fit for a role we're hiring for. Would love to connect!";
const DEFAULT_DM = "Hi {{firstName}}, thanks for connecting! I'm reaching out about an exciting {{role}} opportunity at our company. Given your background at {{company}}, I thought you'd be a great fit. Would you be open to a quick chat?";

function VarChips({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {VARIABLES.map(v => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors font-mono"
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function CampaignForm({ accounts, initialValues, onSubmit, submitLabel = "Save" }: Props) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [channel] = useState(initialValues?.channel ?? "LINKEDIN_INVITE");
  const [threshold, setThreshold] = useState(initialValues?.threshold?.minScorePercent ?? 70);
  const [approvalMode, setApprovalMode] = useState(initialValues?.approvalMode ?? "REVIEW");
  const [dailyCap, setDailyCap] = useState(initialValues?.dailyCap ?? 20);
  const [sendingAccountId, setSendingAccountId] = useState(initialValues?.sendingAccountId ?? "");
  const [status, setStatus] = useState(initialValues?.status ?? "DRAFT");
  const [inviteNote, setInviteNote] = useState(initialValues?.template?.inviteNote ?? DEFAULT_INVITE);
  const [dmBody, setDmBody] = useState(initialValues?.template?.body ?? DEFAULT_DM);
  const [expandedTemplate, setExpandedTemplate] = useState<"invite" | "dm" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Name is required";
    if (threshold < 0 || threshold > 100) errs.threshold = "Must be 0–100";
    if (dailyCap < 1) errs.dailyCap = "Must be at least 1";
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        channel,
        threshold: { minScorePercent: threshold },
        approvalMode,
        dailyCap,
        sendingAccountId: sendingAccountId || "",
        status,
        template: { body: dmBody, inviteNote: inviteNote || undefined },
      });
    } catch (err: any) {
      setErrors({ submit: err.message || "Something went wrong" });
    } finally {
      setSubmitting(false);
    }
  }

  const templates = [
    {
      key: "invite" as const,
      label: "Connection Invite Note",
      hint: "Sent with the LinkedIn connection request (max 300 chars)",
      value: inviteNote,
      onChange: (v: string) => setInviteNote(v.slice(0, 300)),
      counter: `${inviteNote.length}/300`,
      counterWarn: inviteNote.length > 280,
      placeholder: DEFAULT_INVITE,
      rows: 3,
    },
    {
      key: "dm" as const,
      label: "First DM",
      hint: "Sent automatically once the connection is accepted",
      value: dmBody,
      onChange: (v: string) => setDmBody(v),
      placeholder: DEFAULT_DM,
      rows: 4,
    },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Campaign name */}
      <div className="space-y-1.5">
        <Label htmlFor="c-name" className="text-xs">Campaign name</Label>
        <Input
          id="c-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. SDR India LinkedIn Outreach"
          className={cn("h-8 text-sm", errors.name && "border-destructive")}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      {/* Row 1: threshold / cap / approval */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="c-threshold" className="text-xs">Score threshold (%)</Label>
          <Input
            id="c-threshold"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className={cn("h-8 text-sm", errors.threshold && "border-destructive")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-cap" className="text-xs">Daily invite cap</Label>
          <Input
            id="c-cap"
            type="number"
            min={1}
            max={100}
            value={dailyCap}
            onChange={e => setDailyCap(Number(e.target.value))}
            className={cn("h-8 text-sm", errors.dailyCap && "border-destructive")}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Approval mode</Label>
          <Select value={approvalMode} onValueChange={setApprovalMode}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="REVIEW">Manual review</SelectItem>
              <SelectItem value="AUTO">Auto-approve</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Row 2: account / status */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">LinkedIn account</Label>
          <Select value={sendingAccountId || "__none"} onValueChange={v => setSendingAccountId(v === "__none" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select account…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name || a.accountId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PAUSED">Paused</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Message templates — compact accordion */}
      <div className="border-t border-border pt-4 space-y-2">
        <p className="text-xs font-semibold text-foreground">Message templates</p>
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
          {templates.map(t => {
            const open = expandedTemplate === t.key;
            const preview = t.value.trim()
              ? t.value.slice(0, 60) + (t.value.length > 60 ? "…" : "")
              : "Not set";
            return (
              <div key={t.key}>
                {/* Row */}
                <button
                  type="button"
                  onClick={() => setExpandedTemplate(open ? null : t.key)}
                  className="w-full flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{t.label}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.counter && (
                      <span className={cn("text-[10px] tabular-nums", t.counterWarn ? "text-destructive" : "text-muted-foreground")}>
                        {t.counter}
                      </span>
                    )}
                    {open
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </button>

                {/* Expanded editor */}
                {open && (
                  <div className="px-4 pb-4 pt-1 bg-muted/20 space-y-2">
                    <p className="text-[11px] text-muted-foreground">{t.hint}</p>
                    <Textarea
                      value={t.value}
                      onChange={e => t.onChange(e.target.value)}
                      placeholder={t.placeholder}
                      rows={t.rows}
                      className="text-sm resize-none bg-background"
                    />
                    <VarChips onInsert={v => t.onChange(t.value + v)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {errors.submit && <p className="text-xs text-destructive">{errors.submit}</p>}

      <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}

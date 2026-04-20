"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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

const VARIABLE_CHIPS = ["{{firstName}}", "{{name}}", "{{company}}", "{{role}}", "{{score}}"];

export function CampaignForm({ accounts, initialValues, onSubmit, submitLabel = "Save" }: Props) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [channel] = useState(initialValues?.channel ?? "LINKEDIN_INVITE");
  const [threshold, setThreshold] = useState(initialValues?.threshold?.minScorePercent ?? 70);
  const [approvalMode, setApprovalMode] = useState(initialValues?.approvalMode ?? "REVIEW");
  const [dailyCap, setDailyCap] = useState(initialValues?.dailyCap ?? 20);
  const [sendingAccountId, setSendingAccountId] = useState(initialValues?.sendingAccountId ?? "");
  const [status, setStatus] = useState(initialValues?.status ?? "DRAFT");
  const [inviteNote, setInviteNote] = useState(initialValues?.template?.inviteNote ?? "");
  const [dmBody, setDmBody] = useState(initialValues?.template?.body ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function appendVar(field: "inviteNote" | "dmBody", variable: string) {
    if (field === "inviteNote") setInviteNote(v => v + variable);
    else setDmBody(v => v + variable);
  }

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

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="c-name" className="text-xs">Campaign name</Label>
        <Input
          id="c-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Senior Engineer LinkedIn Outreach"
          className={cn("h-8 text-sm", errors.name && "border-destructive")}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Threshold */}
        <div className="space-y-1.5">
          <Label htmlFor="c-threshold" className="text-xs">
            Score threshold (%)
          </Label>
          <Input
            id="c-threshold"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className={cn("h-8 text-sm", errors.threshold && "border-destructive")}
          />
          {errors.threshold && <p className="text-xs text-destructive">{errors.threshold}</p>}
        </div>

        {/* Daily cap */}
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
          {errors.dailyCap && <p className="text-xs text-destructive">{errors.dailyCap}</p>}
        </div>

        {/* Approval mode */}
        <div className="space-y-1.5">
          <Label className="text-xs">Approval mode</Label>
          <Select value={approvalMode} onValueChange={setApprovalMode}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REVIEW">Manual review</SelectItem>
              <SelectItem value="AUTO">Auto-approve</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Sending account */}
        <div className="space-y-1.5">
          <Label className="text-xs">LinkedIn account</Label>
          <Select value={sendingAccountId || "__none"} onValueChange={v => setSendingAccountId(v === "__none" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select account…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None</SelectItem>
              {accounts.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name || a.accountId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="PAUSED">Paused</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs font-medium text-foreground">Message templates</p>
        <p className="text-xs text-muted-foreground">
          Available variables:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLE_CHIPS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => appendVar("dmBody", v)}
              className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors font-mono"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Invite note */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="c-invite" className="text-xs">
            LinkedIn connection note
            <span className="ml-1.5 text-muted-foreground font-normal">(optional, max 300 chars)</span>
          </Label>
          <span className={cn("text-[10px]", inviteNote.length > 280 ? "text-destructive" : "text-muted-foreground")}>
            {inviteNote.length}/300
          </span>
        </div>
        <div className="relative">
          <Textarea
            id="c-invite"
            value={inviteNote}
            onChange={e => setInviteNote(e.target.value.slice(0, 300))}
            placeholder="Hi {{firstName}}, I came across your profile and would love to connect…"
            rows={3}
            className="text-sm resize-none"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {VARIABLE_CHIPS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => appendVar("inviteNote", v)}
              className="text-[10px] px-2 py-0.5 rounded-full border border-border bg-muted text-muted-foreground hover:text-foreground transition-colors font-mono"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* First DM template */}
      <div className="space-y-1.5">
        <Label htmlFor="c-dm" className="text-xs">
          First DM (sent when invite accepted)
        </Label>
        <Textarea
          id="c-dm"
          value={dmBody}
          onChange={e => setDmBody(e.target.value)}
          placeholder="Hi {{firstName}}, thanks for connecting! I'm reaching out about an exciting opportunity…"
          rows={5}
          className="text-sm resize-none"
        />
      </div>

      {errors.submit && (
        <p className="text-xs text-destructive">{errors.submit}</p>
      )}

      <Button type="submit" size="sm" disabled={submitting} className="gap-1.5">
        {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}

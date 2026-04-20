"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus, Zap, Pencil, Trash2, Pause, Play, Loader2,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { CampaignForm, type CampaignFormValues } from "./CampaignForm";

interface Account {
  id: string;
  accountId: string;
  name: string;
}

interface Campaign {
  id: string;
  name: string;
  channel: string;
  status: string;
  approvalMode: string;
  dailyCap: number;
  threshold: string;
  template: string;
  sendingAccountId: string | null;
  sendingAccount: Account | null;
  createdAt: string;
  _count: { messages: number };
}

interface Props {
  requisitionId: string;
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  PAUSED: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  DRAFT: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  ARCHIVED: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

export function CampaignTab({ requisitionId }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/campaigns`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch {
      toast.error("Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [requisitionId]);

  useEffect(() => {
    fetchCampaigns();
    fetch("/api/accounts")
      .then(r => r.json())
      .then(d => setAccounts(d.accounts ?? []))
      .catch(() => {});
  }, [fetchCampaigns]);

  async function handleCreate(values: CampaignFormValues) {
    const res = await fetch(`/api/requisitions/${requisitionId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || "Failed to create campaign");
    }
    await fetchCampaigns();
    setShowForm(false);
    toast.success("Campaign created");
  }

  async function handleUpdate(values: CampaignFormValues) {
    if (!editing) return;
    const res = await fetch(
      `/api/requisitions/${requisitionId}/campaigns/${editing.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      },
    );
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || "Failed to update campaign");
    }
    await fetchCampaigns();
    setEditing(null);
    toast.success("Campaign updated");
  }

  async function handleDelete(campaignId: string) {
    setDeleting(campaignId);
    try {
      await fetch(`/api/requisitions/${requisitionId}/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      setCampaigns(prev => prev.filter(c => c.id !== campaignId));
      toast.success("Campaign archived");
    } catch {
      toast.error("Failed to archive campaign");
    } finally {
      setDeleting(null);
    }
  }

  async function handleToggleStatus(campaign: Campaign) {
    const newStatus = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setToggling(campaign.id);
    try {
      const res = await fetch(
        `/api/requisitions/${requisitionId}/campaigns/${campaign.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) throw new Error();
      setCampaigns(prev =>
        prev.map(c => (c.id === campaign.id ? { ...c, status: newStatus } : c)),
      );
      toast.success(newStatus === "ACTIVE" ? "Campaign activated" : "Campaign paused");
    } catch {
      toast.error("Failed to update campaign status");
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold">Outreach Campaigns</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure auto-shortlisting and LinkedIn outreach for this role.
          </p>
        </div>
        {!showForm && !editing && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5" />
            New campaign
          </Button>
        )}
      </div>

      {/* Inline form */}
      {(showForm || editing) && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-sm font-medium">
              {editing ? "Edit campaign" : "New campaign"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => { setShowForm(false); setEditing(null); }}
            >
              Cancel
            </Button>
          </div>
          <div className="p-6">
            <CampaignForm
              accounts={accounts}
              initialValues={editing ? campaignToFormValues(editing) : undefined}
              onSubmit={editing ? handleUpdate : handleCreate}
              submitLabel={editing ? "Save changes" : "Create campaign"}
            />
          </div>
        </div>
      )}

      {campaigns.length === 0 && !showForm ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center border border-dashed border-border rounded-xl">
          <Zap className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-semibold text-muted-foreground">No campaigns yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
            Create a campaign to auto-shortlist candidates and send LinkedIn outreach.
          </p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setShowForm(true)}>
            <Plus className="h-3.5 w-3.5" />
            New campaign
          </Button>
        </div>
      ) : (
        /* Full-width table */
        <div className="rounded-xl border border-border overflow-hidden bg-background">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Campaign</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-36">Channel</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-32">Threshold</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-28">Approval</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-24">Cap / day</th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-24">Messages</th>
                <th className="px-4 py-2.5 w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {campaigns.map(campaign => {
                let thresholdPct = 70;
                try { thresholdPct = JSON.parse(campaign.threshold)?.minScorePercent ?? 70; } catch {}

                return (
                  <tr key={campaign.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{campaign.name}</span>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] h-5 px-2 rounded-full shrink-0", STATUS_STYLES[campaign.status])}
                        >
                          {campaign.status}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {campaign.channel === "LINKEDIN_INVITE" ? "LinkedIn Invite" : campaign.channel}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{thresholdPct}% min score</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {campaign.approvalMode === "AUTO" ? "Auto" : "Manual"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{campaign.dailyCap}</td>
                    <td className="px-4 py-3 text-xs font-medium text-foreground">{campaign._count.messages}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {(campaign.status === "ACTIVE" || campaign.status === "PAUSED") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground"
                            disabled={toggling === campaign.id}
                            onClick={() => handleToggleStatus(campaign)}
                            title={campaign.status === "ACTIVE" ? "Pause" : "Activate"}
                          >
                            {toggling === campaign.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : campaign.status === "ACTIVE" ? (
                              <Pause className="h-3.5 w-3.5" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground"
                          onClick={() => { setEditing(campaign); setShowForm(false); }}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          disabled={deleting === campaign.id}
                          onClick={() => handleDelete(campaign.id)}
                          title="Archive"
                        >
                          {deleting === campaign.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function campaignToFormValues(campaign: Campaign): CampaignFormValues {
  let threshold = { minScorePercent: 70 };
  let template = { body: "", inviteNote: "" };
  try { threshold = JSON.parse(campaign.threshold); } catch {}
  try { template = JSON.parse(campaign.template); } catch {}

  return {
    name: campaign.name,
    channel: campaign.channel,
    threshold,
    approvalMode: campaign.approvalMode,
    dailyCap: campaign.dailyCap,
    sendingAccountId: campaign.sendingAccountId ?? "",
    status: campaign.status,
    template,
  };
}

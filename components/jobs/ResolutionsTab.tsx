"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, FileText, Upload, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FailedTask {
  id: string;
  url: string;
  source: string;
  sourceFileName: string | null;
  sourceFileUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
}

export function ResolutionsTab({ requisitionId }: { requisitionId: string }) {
  const [tasks, setTasks] = useState<FailedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = () => {
    setLoading(true);
    // Add ?status=FAILED to fetch only failed tasks. The candidates route needs to support this.
    fetch(`/api/requisitions/${requisitionId}/candidates?status=FAILED`)
      .then(res => res.json())
      .then(data => {
        if (data.tasks) setTasks(data.tasks.filter((t: any) => t.status === "FAILED"));
      })
      .catch(() => setError("Failed to load tasks"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTasks();
  }, [requisitionId]);

  if (loading) {
    return (
      <div className="p-8 flex justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-rose-500 text-center text-sm">{error}</div>;
  }

  if (tasks.length === 0) {
    return (
      <div className="p-12 text-center text-muted-foreground">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3">
          <AlertTriangle className="h-6 w-6 text-emerald-500" />
        </div>
        <p className="text-sm font-medium">No failed tasks</p>
        <p className="text-xs mt-1">Everything looks good! There are no errors needing your attention.</p>
        <Button variant="outline" size="sm" onClick={fetchTasks} className="mt-4">
          <RefreshCw className="h-3 w-3 mr-2" /> Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500" />
          Needs Attention ({tasks.length})
        </h2>
        <Button variant="ghost" size="sm" onClick={fetchTasks} className="h-8">
          <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
        </Button>
      </div>

      <div className="space-y-4">
        {tasks.map(task => (
          <ResolutionCard key={task.id} task={task} onResolved={fetchTasks} />
        ))}
      </div>
    </div>
  );
}

function ResolutionCard({ task, onResolved }: { task: FailedTask; onResolved: () => void }) {
  const [mode, setMode] = useState<"view" | "manual">("view");
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ name: "", headline: "", location: "", currentOrg: "", currentDesignation: "" });

  const handleRetry = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error();
      onResolved();
    } catch {
      alert("Failed to retry task");
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/manual-entry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error();
      onResolved();
    } catch {
      alert("Failed to save manual entry");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="p-4 bg-muted/30 border-b border-border flex flex-wrap gap-4 items-start justify-between">
        <div>
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            {task.sourceFileName || task.url}
            {task.sourceFileUrl && (
              <a href={`/api/tasks/${task.id}/resume`} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1">
                <FileText className="h-3 w-3" /> View File
              </a>
            )}
          </p>
          <div className="mt-2 text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded p-2 max-w-2xl">
            {task.errorMessage || "Unknown parsing error"}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {mode === "view" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setMode("manual")} disabled={submitting}>
                Enter Manually
              </Button>
              <Button size="sm" onClick={handleRetry} disabled={submitting}>
                {submitting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Retry Parsing
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setMode("view")} disabled={submitting}>Cancel</Button>
          )}
        </div>
      </div>

      {mode === "manual" && (
        <form onSubmit={handleManualSubmit} className="p-4 bg-background border-t border-border space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Candidate Name *</Label>
              <Input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="h-8 text-sm" placeholder="John Doe" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Headline / Title *</Label>
              <Input required value={formData.headline} onChange={e => setFormData({ ...formData, headline: e.target.value })} className="h-8 text-sm" placeholder="Software Engineer" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Input value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} className="h-8 text-sm" placeholder="San Francisco, CA" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Current Organization</Label>
              <Input value={formData.currentOrg} onChange={e => setFormData({ ...formData, currentOrg: e.target.value })} className="h-8 text-sm" placeholder="Acme Corp" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={submitting || !formData.name || !formData.headline}>
              {submitting ? "Saving..." : "Save Candidate"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { JobCard, RequisitionSummary } from "@/components/jobs/JobCard";

export default function JobsPage() {
  const router = useRouter();
  const [reqs, setReqs] = useState<RequisitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function fetchReqs() {
    try {
      const res = await fetch("/api/requisitions?page=1&limit=100");
      if (res.ok) {
        const data = await res.json();
        setReqs(data.requisitions || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReqs();
  }, []);

  useEffect(() => {
    const hasActive = reqs.some(r => r.activeRunStatus !== null);
    if (!hasActive) return;
    const interval = setInterval(fetchReqs, 5000);
    return () => clearInterval(interval);
  }, [reqs]);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/requisitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), department: newDepartment.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create" }));
        setCreateError(err.error || "Failed to create");
        return;
      }
      const data = await res.json();
      setShowNewModal(false);
      setNewTitle("");
      setNewDepartment("");
      router.push(`/jobs/JD-${data.id.slice(0, 8).toUpperCase()}`);
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  const filtered = reqs.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.department.toLowerCase().includes(q);
  });

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Job Roles</h1>
            <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
              {reqs.length}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Each role owns its JD and scoring rules. Run bulk analyses to add candidates.
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          New Role
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search roles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="ml-auto flex items-center gap-1 border border-border rounded-lg p-1 bg-card">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("grid")}
            className="h-7 w-7 p-0"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("list")}
            className="h-7 w-7 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className={viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          : "space-y-3"
        }>
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-44 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      ) : (
        <div className={viewMode === "grid"
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          : "space-y-3"
        }>
          {filtered.map(r => (
            <JobCard
              key={r.id}
              requisition={r}
              viewMode={viewMode}
              onClick={() => router.push(`/jobs/JD-${r.id.slice(0, 8).toUpperCase()}`)}
            />
          ))}

          {viewMode === "grid" ? (
            <button
              onClick={() => setShowNewModal(true)}
              className="min-h-44 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-colors group"
            >
              <div className="h-9 w-9 rounded-full border-2 border-border group-hover:border-primary/50 flex items-center justify-center transition-colors">
                <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">Open New Role</p>
                <p className="text-xs text-muted-foreground/60">Configure JD and scoring rules</p>
              </div>
            </button>
          ) : (
            <button
              onClick={() => setShowNewModal(true)}
              className="w-full h-14 border-2 border-dashed border-border rounded-xl flex items-center justify-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-colors group px-4"
            >
              <Plus className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              <span className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">Open New Role</span>
            </button>
          )}
        </div>
      )}

      {/* New Role Modal */}
      <Dialog open={showNewModal} onOpenChange={setShowNewModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Open New Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Job Title <span className="text-destructive">*</span></Label>
              <Input
                id="req-title"
                placeholder="e.g. Senior SDE"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-dept">Department</Label>
              <Input
                id="req-dept"
                placeholder="e.g. Engineering"
                value={newDepartment}
                onChange={e => setNewDepartment(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
            {createError && (
              <p className="text-xs text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !newTitle.trim()}>
              {creating ? "Creating..." : "Create Role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

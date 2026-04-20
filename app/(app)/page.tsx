"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { JobCard, RequisitionSummary } from "@/components/jobs/JobCard";
import { CreatableCombobox } from "@/components/ui/creatable-combobox";

export default function JobsPage() {
  const router = useRouter();
  const [reqs, setReqs] = useState<RequisitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDepartment, setNewDepartment] = useState("");
  const [newRecruiter, setNewRecruiter] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingReq, setEditingReq] = useState<RequisitionSummary | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDepartment, setEditDepartment] = useState("");
  const [editRecruiter, setEditRecruiter] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
        body: JSON.stringify({
          title: newTitle.trim(),
          department: newDepartment.trim(),
          recruiterName: newRecruiter.trim(),
          startDate: newStartDate || null,
        }),
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
      setNewRecruiter("");
      setNewStartDate("");
      router.push(`/jobs/JD-${data.id.slice(0, 8).toUpperCase()}`);
    } catch (err: any) {
      setCreateError(err?.message || "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(r: RequisitionSummary) {
    setEditingReq(r);
    setEditTitle(r.title);
    setEditDepartment(r.department);
    setEditRecruiter(r.recruiterName);
    setEditStartDate(r.startDate ? new Date(r.startDate).toISOString().split("T")[0] : "");
    setEditIsActive(r.isActive ?? true);
    setSaveError(null);
    setConfirmDelete(false);
  }

  async function handleDelete() {
    if (!editingReq) return;
    setDeleting(true);
    try {
      await fetch(`/api/requisitions/${editingReq.id}`, { method: "DELETE" });
      setReqs(prev => prev.filter(r => r.id !== editingReq.id));
      setEditingReq(null);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingReq || !editTitle.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/requisitions/${editingReq.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          department: editDepartment.trim(),
          recruiterName: editRecruiter.trim(),
          startDate: editStartDate || null,
          isActive: editIsActive,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to save" }));
        setSaveError(err.error || "Failed to save");
        return;
      }
      setReqs(prev => prev.map(r =>
        r.id === editingReq.id
          ? { ...r, title: editTitle.trim(), department: editDepartment.trim(), recruiterName: editRecruiter.trim(), startDate: editStartDate || null, isActive: editIsActive }
          : r
      ));
      setEditingReq(null);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const existingDepartments = Array.from(new Set(reqs.map(r => r.department).filter(Boolean)));
  const existingRecruiters = Array.from(new Set(reqs.map(r => r.recruiterName).filter(Boolean)));

  const filtered = reqs.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.department.toLowerCase().includes(q);
  });

  const activeRoles = filtered.filter(r => r.isActive ?? true);
  const inactiveRoles = filtered.filter(r => !(r.isActive ?? true));

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
        <div className="space-y-8">
          {/* Active roles */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Active</h2>
              <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                {activeRoles.length}
              </span>
            </div>
            <div className={viewMode === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
              : "space-y-3"
            }>
              {activeRoles.map(r => (
                <JobCard
                  key={r.id}
                  requisition={r}
                  viewMode={viewMode}
                  onClick={() => router.push(`/jobs/JD-${r.id.slice(0, 8).toUpperCase()}`)}
                  onEdit={openEdit}
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
          </div>

          {/* Inactive roles */}
          {inactiveRoles.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Inactive</h2>
                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
                  {inactiveRoles.length}
                </span>
              </div>
              <div className={viewMode === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 opacity-70"
                : "space-y-3 opacity-70"
              }>
                {inactiveRoles.map(r => (
                  <JobCard
                    key={r.id}
                    requisition={r}
                    viewMode={viewMode}
                    onClick={() => router.push(`/jobs/JD-${r.id.slice(0, 8).toUpperCase()}`)}
                    onEdit={openEdit}
                  />
                ))}
              </div>
            </div>
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
              <CreatableCombobox
                id="req-dept"
                options={existingDepartments}
                value={newDepartment}
                onChange={setNewDepartment}
                placeholder="e.g. Engineering"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-recruiter">Primary Recruiter</Label>
              <CreatableCombobox
                id="req-recruiter"
                options={existingRecruiters}
                value={newRecruiter}
                onChange={setNewRecruiter}
                placeholder="e.g. Priya Sharma"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-start">Start Date</Label>
              <Input
                id="req-start"
                type="date"
                value={newStartDate}
                onChange={e => setNewStartDate(e.target.value)}
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

      {/* Quick Edit Modal */}
      <Dialog open={!!editingReq} onOpenChange={open => !open && setEditingReq(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Job Title <span className="text-destructive">*</span></Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSaveEdit()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-dept">Department</Label>
              <CreatableCombobox
                id="edit-dept"
                options={existingDepartments}
                value={editDepartment}
                onChange={setEditDepartment}
                placeholder="e.g. Engineering"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-recruiter">Primary Recruiter</Label>
              <CreatableCombobox
                id="edit-recruiter"
                options={existingRecruiters}
                value={editRecruiter}
                onChange={setEditRecruiter}
                placeholder="e.g. Priya Sharma"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-start">Start Date</Label>
              <Input
                id="edit-start"
                type="date"
                value={editStartDate}
                onChange={e => setEditStartDate(e.target.value)}
              />
            </div>

            {/* Active / Inactive toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <Label htmlFor="edit-isactive" className="text-sm font-medium cursor-pointer">
                  {editIsActive ? "Active" : "Inactive"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {editIsActive
                    ? "This role is open and visible on the dashboard"
                    : "This role is paused — no new analysis will be triggered"}
                </p>
              </div>
              <Switch
                id="edit-isactive"
                checked={editIsActive}
                onCheckedChange={setEditIsActive}
                className="data-[state=checked]:bg-emerald-500"
              />
            </div>
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            {confirmDelete ? (
              <div className="flex items-center gap-2 w-full sm:w-auto mr-auto">
                <span className="text-xs text-destructive">Delete this role?</span>
                <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting..." : "Yes, delete"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>No</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 mr-auto" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditingReq(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving || !editTitle.trim()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

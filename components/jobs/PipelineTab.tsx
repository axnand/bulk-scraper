"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  RefreshCw, LayoutGrid, Search, X, ExternalLink,
  Send, MessageSquare, ChevronDown, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { KanbanColumn } from "@/components/outreach/KanbanColumn";
import { PipelineTask } from "@/components/outreach/CandidateKanbanCard";
import {
  CandidateStage,
  STAGE_CONFIG,
  ACTIVE_STAGES,
  ARCHIVE_STAGES,
  PIPELINE_STAGES,
} from "@/components/outreach/stage-config";

interface Props {
  requisitionId: string;
}

type StageMap = Partial<Record<CandidateStage, PipelineTask[]>>;

function matchesQuery(task: PipelineTask, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    task.name.toLowerCase().includes(needle) ||
    task.currentDesignation.toLowerCase().includes(needle) ||
    task.headline.toLowerCase().includes(needle) ||
    task.currentOrg.toLowerCase().includes(needle)
  );
}

export function PipelineTab({ requisitionId }: Props) {
  const [stages, setStages] = useState<StageMap>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"ALL" | CandidateStage>("ALL");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkInviting, setBulkInviting] = useState(false);
  const [bulkMessaging, setBulkMessaging] = useState(false);

  const fetchPipeline = useCallback(async () => {
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/pipeline`);
      if (!res.ok) throw new Error("Failed to load pipeline");
      const data = await res.json();
      setStages(data.stages ?? {});
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Could not load pipeline data");
    } finally {
      setLoading(false);
    }
  }, [requisitionId]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  useEffect(() => {
    function onDragStart(e: DragEvent) {
      const id = (e.target as HTMLElement)?.closest("[data-task-id]")?.getAttribute("data-task-id");
      if (id) setDraggingId(id);
    }
    function onDragEnd() { setDraggingId(null); }
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  async function handleStageChange(taskId: string, newStage: CandidateStage) {
    let fromStage: CandidateStage | null = null;
    let movedTask: PipelineTask | null = null;

    for (const stage of PIPELINE_STAGES) {
      const found = stages[stage]?.find(t => t.id === taskId);
      if (found) { fromStage = stage; movedTask = found; break; }
    }

    if (!fromStage || !movedTask || fromStage === newStage) return;

    setStages(prev => {
      const next = { ...prev };
      next[fromStage!] = (next[fromStage!] ?? []).filter(t => t.id !== taskId);
      const updated: PipelineTask = { ...movedTask!, stage: newStage, stageUpdatedAt: new Date().toISOString() };
      next[newStage] = [updated, ...(next[newStage] ?? [])];
      return next;
    });

    try {
      const res = await fetch(
        `/api/requisitions/${requisitionId}/candidates/${taskId}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: newStage }) }
      );
      if (!res.ok) throw new Error("Update failed");
      toast.success(`Moved to ${STAGE_CONFIG[newStage].label}`);
    } catch {
      setStages(prev => {
        const next = { ...prev };
        next[newStage] = (next[newStage] ?? []).filter(t => t.id !== taskId);
        next[fromStage!] = [movedTask!, ...(next[fromStage!] ?? [])];
        return next;
      });
      toast.error("Failed to update stage");
    }
  }

  // Selection helpers
  function handleSelect(taskId: string, selected: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selected) next.add(taskId); else next.delete(taskId);
      return next;
    });
  }

  function handleColumnSelectAll(taskIds: string[]) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      taskIds.forEach(id => next.add(id));
      return next;
    });
  }

  function handleColumnDeselectAll(taskIds: string[]) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      taskIds.forEach(id => next.delete(id));
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  // Compute selected tasks by stage for bulk actions
  const selectedByStage = useMemo(() => {
    const map: Partial<Record<CandidateStage, string[]>> = {};
    for (const stage of PIPELINE_STAGES) {
      const ids = (stages[stage] ?? []).filter(t => selectedIds.has(t.id)).map(t => t.id);
      if (ids.length > 0) map[stage] = ids;
    }
    return map;
  }, [stages, selectedIds]);

  const shortlistedSelected = selectedByStage["SHORTLISTED"]?.length ?? 0;
  const connectedSelected = selectedByStage["CONNECTED"]?.length ?? 0;

  async function handleBulkInvite() {
    const taskIds = selectedByStage["SHORTLISTED"] ?? [];
    if (!taskIds.length) return;
    setBulkInviting(true);
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/candidates/bulk-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk invite failed");
      toast.success(`Sent ${data.sent} LinkedIn invite${data.sent !== 1 ? "s" : ""}${data.failed > 0 ? `, ${data.failed} failed` : ""}`);
      // Optimistically move successful ones to CONTACT_REQUESTED
      const sentIds: string[] = data.results.filter((r: any) => r.ok).map((r: any) => r.taskId);
      setStages(prev => {
        let next = { ...prev };
        for (const id of sentIds) {
          const task = (next["SHORTLISTED"] ?? []).find(t => t.id === id);
          if (!task) continue;
          next["SHORTLISTED"] = (next["SHORTLISTED"] ?? []).filter(t => t.id !== id);
          next["CONTACT_REQUESTED"] = [
            { ...task, stage: "CONTACT_REQUESTED", stageUpdatedAt: new Date().toISOString() },
            ...(next["CONTACT_REQUESTED"] ?? []),
          ];
        }
        return next;
      });
      setSelectedIds(prev => {
        const next = new Set(prev);
        sentIds.forEach(id => next.delete(id));
        return next;
      });
    } catch (err: any) {
      toast.error(err.message || "Bulk invite failed");
    } finally {
      setBulkInviting(false);
    }
  }

  async function handleBulkMessage() {
    const taskIds = selectedByStage["CONNECTED"] ?? [];
    if (!taskIds.length) return;
    setBulkMessaging(true);
    try {
      const res = await fetch(`/api/requisitions/${requisitionId}/candidates/bulk-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk message failed");
      toast.success(`Queued ${data.queued} DM${data.queued !== 1 ? "s" : ""}${data.failed > 0 ? `, ${data.failed} failed` : ""}`);
      setSelectedIds(prev => {
        const next = new Set(prev);
        taskIds.forEach(id => next.delete(id));
        return next;
      });
      // Refresh to pick up stage changes from worker
      setTimeout(fetchPipeline, 2000);
    } catch (err: any) {
      toast.error(err.message || "Bulk message failed");
    } finally {
      setBulkMessaging(false);
    }
  }

  async function handleBulkMove(newStage: CandidateStage) {
    const taskIds = [...selectedIds];
    if (!taskIds.length) return;
    // Optimistically move all
    const snapshot = { ...stages };
    setStages(prev => {
      const next = { ...prev };
      for (const id of taskIds) {
        for (const s of PIPELINE_STAGES) {
          const idx = (next[s] ?? []).findIndex(t => t.id === id);
          if (idx !== -1) {
            const task = next[s]![idx];
            next[s] = (next[s] ?? []).filter(t => t.id !== id);
            next[newStage] = [
              { ...task, stage: newStage, stageUpdatedAt: new Date().toISOString() },
              ...(next[newStage] ?? []),
            ];
            break;
          }
        }
      }
      return next;
    });
    clearSelection();

    try {
      await Promise.all(
        taskIds.map(id =>
          fetch(`/api/requisitions/${requisitionId}/candidates/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: newStage }),
          }),
        ),
      );
      toast.success(`Moved ${taskIds.length} candidate${taskIds.length !== 1 ? "s" : ""} to ${STAGE_CONFIG[newStage].label}`);
    } catch {
      setStages(snapshot);
      toast.error("Failed to move some candidates");
    }
  }

  const filteredStages = useMemo<StageMap>(() => {
    if (!query) return stages;
    const out: StageMap = {};
    for (const stage of PIPELINE_STAGES) {
      const tasks = stages[stage];
      if (tasks) out[stage] = tasks.filter(t => matchesQuery(t, query));
    }
    return out;
  }, [stages, query]);

  const archiveRows = useMemo(() => {
    const rows: PipelineTask[] = [];
    for (const stage of ARCHIVE_STAGES) {
      if (archiveFilter !== "ALL" && archiveFilter !== stage) continue;
      for (const t of stages[stage] ?? []) {
        if (matchesQuery(t, query)) rows.push(t);
      }
    }
    return rows.sort((a, b) => new Date(b.stageUpdatedAt).getTime() - new Date(a.stageUpdatedAt).getTime());
  }, [stages, query, archiveFilter]);

  const archiveTotal = ARCHIVE_STAGES.reduce((n, s) => n + (stages[s]?.length ?? 0), 0);
  const showCheckboxes = selectedIds.size > 0;

  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {ACTIVE_STAGES.map(stage => (
          <div key={stage} className="flex flex-col w-[272px] shrink-0 gap-2">
            <Skeleton className="h-10 rounded-xl" />
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <Tabs defaultValue="board" className="flex flex-col flex-1 min-h-0 gap-3">
        <div className="flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <div className="flex items-center gap-3">
            <TabsList>
              <TabsTrigger value="board">Board</TabsTrigger>
              <TabsTrigger value="archive" className="gap-1.5">
                Archive
                {archiveTotal > 0 && (
                  <span className="rounded-full bg-muted-foreground/15 text-xs px-1.5 font-semibold">
                    {archiveTotal}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <LayoutGrid className="h-4 w-4" />
              <span className="font-medium text-foreground">{total}</span>
              <span>in pipeline</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, title, company..."
                className="pl-8 pr-8 h-8 text-sm w-64"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchPipeline}
              className="gap-1.5 text-xs text-muted-foreground h-8 px-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <TabsContent value="board" className="flex-1 min-h-0 mt-0">
          <div className="flex gap-3 overflow-x-auto pb-4 h-full">
            {ACTIVE_STAGES.map(stage => (
              <KanbanColumn
                key={stage}
                stage={stage}
                config={STAGE_CONFIG[stage]}
                tasks={filteredStages[stage] ?? []}
                onStageChange={handleStageChange}
                draggingId={draggingId}
                requisitionId={requisitionId}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onColumnSelectAll={handleColumnSelectAll}
                onColumnDeselectAll={handleColumnDeselectAll}
                showCheckboxes={showCheckboxes}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="archive" className="flex-1 min-h-0 mt-0">
          <div className="flex flex-col h-full gap-3">
            <div className="flex items-center gap-2 shrink-0">
              {(["ALL", ...ARCHIVE_STAGES] as const).map(f => {
                const label = f === "ALL" ? "All" : STAGE_CONFIG[f].label;
                const count = f === "ALL" ? archiveTotal : stages[f]?.length ?? 0;
                const active = archiveFilter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setArchiveFilter(f)}
                    className={cn(
                      "flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium transition-colors border",
                      active
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background text-muted-foreground border-border hover:text-foreground",
                    )}
                  >
                    {f !== "ALL" && <span className={cn("h-1.5 w-1.5 rounded-full", STAGE_CONFIG[f].dot)} />}
                    {label}
                    <span className={cn("rounded-full px-1.5 text-[10px] font-semibold", active ? "bg-background/20" : "bg-muted")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border/60 bg-background">
              {archiveRows.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                  {query ? "No matches in archive" : "No archived candidates"}
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {archiveRows.map(task => (
                    <ArchiveRow key={task.id} task={task} onStageChange={handleStageChange} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background border border-border rounded-2xl shadow-2xl px-4 py-2.5 animate-in slide-in-from-bottom-2 duration-150">
          <span className="text-sm font-semibold text-foreground whitespace-nowrap">
            {selectedIds.size} selected
          </span>

          <div className="w-px h-5 bg-border mx-1" />

          {shortlistedSelected > 0 && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              disabled={bulkInviting}
              onClick={handleBulkInvite}
            >
              {bulkInviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {bulkInviting ? "Sending…" : `Send invite (${shortlistedSelected})`}
            </Button>
          )}

          {connectedSelected > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              disabled={bulkMessaging}
              onClick={handleBulkMessage}
            >
              {bulkMessaging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
              {bulkMessaging ? "Queuing…" : `Send DM (${connectedSelected})`}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                Move to
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top" className="w-44 mb-1">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Move {selectedIds.size} to…</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {PIPELINE_STAGES.map(stage => (
                <DropdownMenuItem
                  key={stage}
                  onClick={() => handleBulkMove(stage)}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", STAGE_CONFIG[stage].dot)} />
                  {STAGE_CONFIG[stage].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={clearSelection}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

const AVATAR_GRADIENTS = [
  "from-violet-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-blue-600",
  "from-fuchsia-500 to-purple-600",
];

function pickGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

function getInitials(name: string) {
  return name.split(" ").slice(0, 2).map(n => n[0] ?? "").join("").toUpperCase();
}

function ArchiveRow({
  task,
  onStageChange,
}: {
  task: PipelineTask;
  onStageChange: (taskId: string, stage: CandidateStage) => void;
}) {
  const name = task.name || "Unknown";
  const config = STAGE_CONFIG[task.stage];
  const scoreCls =
    task.recommendation === "Strong Fit"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : task.recommendation === "Moderate Fit"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
      : "border-rose-500/40 bg-rose-500/10 text-rose-500";

  return (
    <li className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
      <Avatar className="h-9 w-9 shrink-0">
        <AvatarImage src={task.profilePictureUrl ?? undefined} alt={name} />
        <AvatarFallback className={cn("text-white font-bold text-xs bg-linear-to-br", pickGradient(name))}>
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <Link
          href={`/candidates/${task.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-foreground truncate hover:text-primary hover:underline underline-offset-2 block"
        >
          {name}
        </Link>
        <p className="text-xs text-muted-foreground truncate">
          {task.currentDesignation || task.headline || "—"}
          {task.currentOrg && <span> · {task.currentOrg}</span>}
        </p>
      </div>

      {task.scorePercent !== null && (
        <Badge variant="outline" className={cn("text-xs font-bold h-5 px-2 py-0 rounded-full shrink-0", scoreCls)}>
          {Math.round(task.scorePercent)}%
        </Badge>
      )}

      <Badge
        variant="outline"
        className={cn("gap-1.5 text-xs h-6 px-2 rounded-full shrink-0", config.border, config.headerBg, config.headerText)}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
        {config.label}
      </Badge>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground shrink-0"
        onClick={() => onStageChange(task.id, "SOURCED")}
      >
        Restore
      </Button>

      {task.url && (
        <a
          href={task.url}
          target="_blank"
          rel="noopener noreferrer"
          className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
          aria-label="Open LinkedIn"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </li>
  );
}

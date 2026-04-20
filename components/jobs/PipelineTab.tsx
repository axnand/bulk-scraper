"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { RefreshCw, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { KanbanColumn } from "@/components/outreach/KanbanColumn";
import { PipelineTask } from "@/components/outreach/CandidateKanbanCard";
import {
  CandidateStage,
  STAGE_CONFIG,
  PRIMARY_STAGES,
  PIPELINE_STAGES,
} from "@/components/outreach/stage-config";

interface Props {
  requisitionId: string;
}

type StageMap = Partial<Record<CandidateStage, PipelineTask[]>>;

export function PipelineTab({ requisitionId }: Props) {
  const [stages, setStages] = useState<StageMap>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

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

  useEffect(() => {
    fetchPipeline();
  }, [fetchPipeline]);

  // Global drag tracking for card opacity feedback
  useEffect(() => {
    function onDragStart(e: DragEvent) {
      const id = (e.target as HTMLElement)?.closest("[data-task-id]")?.getAttribute("data-task-id");
      if (id) setDraggingId(id);
    }
    function onDragEnd() {
      setDraggingId(null);
    }
    window.addEventListener("dragstart", onDragStart);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  async function handleStageChange(taskId: string, newStage: CandidateStage) {
    // Find the task's current stage for optimistic rollback
    let fromStage: CandidateStage | null = null;
    let movedTask: PipelineTask | null = null;

    for (const stage of PIPELINE_STAGES) {
      const found = stages[stage]?.find(t => t.id === taskId);
      if (found) {
        fromStage = stage;
        movedTask = found;
        break;
      }
    }

    if (!fromStage || !movedTask || fromStage === newStage) return;

    // Optimistic update
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
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: newStage }),
        }
      );
      if (!res.ok) throw new Error("Update failed");
      toast.success(`Moved to ${STAGE_CONFIG[newStage].label}`);
    } catch {
      // Rollback
      setStages(prev => {
        const next = { ...prev };
        next[newStage] = (next[newStage] ?? []).filter(t => t.id !== taskId);
        next[fromStage!] = [movedTask!, ...(next[fromStage!] ?? [])];
        return next;
      });
      toast.error("Failed to update stage");
    }
  }

  const closedStages: CandidateStage[] = ["HIRED", "REJECTED", "ARCHIVED"];
  const visiblePrimary = PRIMARY_STAGES;

  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PRIMARY_STAGES.map(stage => (
          <div key={stage} className="flex flex-col w-[272px] shrink-0 gap-2">
            <Skeleton className="h-10 rounded-xl" />
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  const hasAnyClosed = closedStages.some(s => (stages[s]?.length ?? 0) > 0);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <LayoutGrid className="h-4 w-4" />
            <span className="font-medium text-foreground">{total}</span>
            <span>candidates in pipeline</span>
          </div>
          {hasAnyClosed && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-7 px-2"
              onClick={() => setShowClosed(v => !v)}
            >
              {showClosed ? "Hide closed" : "Show closed"}
              {closedStages.reduce((n, s) => n + (stages[s]?.length ?? 0), 0) > 0 && (
                <span className="ml-1.5 h-4 w-4 rounded-full bg-muted text-[10px] flex items-center justify-center font-semibold">
                  {closedStages.reduce((n, s) => n + (stages[s]?.length ?? 0), 0)}
                </span>
              )}
            </Button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={fetchPipeline}
          className="gap-1.5 text-xs text-muted-foreground h-7 px-2"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* Kanban board — horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-4 flex-1">
        {visiblePrimary.map(stage => (
          <KanbanColumn
            key={stage}
            stage={stage}
            config={STAGE_CONFIG[stage]}
            tasks={stages[stage] ?? []}
            onStageChange={handleStageChange}
            draggingId={draggingId}
          />
        ))}

        {showClosed && closedStages.map(stage => (
          <KanbanColumn
            key={stage}
            stage={stage}
            config={STAGE_CONFIG[stage]}
            tasks={stages[stage] ?? []}
            onStageChange={handleStageChange}
            draggingId={draggingId}
          />
        ))}
      </div>
    </div>
  );
}

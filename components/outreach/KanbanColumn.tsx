"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CandidateKanbanCard, PipelineTask } from "./CandidateKanbanCard";
import { CandidateStage, StageConfig } from "./stage-config";

interface Props {
  readonly stage: CandidateStage;
  readonly config: StageConfig;
  readonly tasks: PipelineTask[];
  readonly onStageChange: (taskId: string, newStage: CandidateStage) => void;
  readonly draggingId: string | null;
}

export function KanbanColumn({ stage, config, tasks, onStageChange, draggingId }: Props) {
  const [isOver, setIsOver] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsOver(false);
    const taskId = e.dataTransfer.getData("taskId");
    const fromStage = e.dataTransfer.getData("fromStage") as CandidateStage;
    if (taskId && fromStage !== stage) onStageChange(taskId, stage);
  }

  return (
    <section
      aria-label={`${config.label} column`}
      className={cn(
        "flex flex-col w-80 shrink-0 rounded-2xl transition-colors duration-150 overflow-hidden",
        isOver ? "bg-accent/60" : "bg-muted/40"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header — lives inside the rounded container */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", config.dot)} />
        <span className={cn("text-sm font-semibold flex-1 truncate", config.headerText)}>
          {config.label}
        </span>
        <span className={cn(
          "text-xs font-bold flex items-center justify-center",
          "rounded-full border px-1.5 min-w-5.5 h-5.5",
          config.headerBg, config.headerText, config.border
        )}>
          {tasks.length}
        </span>
      </div>

      {/* Cards scroll area — [&>div>div]:!block overrides Radix's display:table on the viewport inner wrapper */}
      <ScrollArea
        className="flex-1 px-2 pb-2 [&>div>div]:!block [&>div>div]:!min-w-0 [&>div>div]:!w-full"
        style={{ height: "calc(100vh - 248px)" }}
      >
        <div className="flex flex-col gap-2 pt-0.5">
          {tasks.length === 0 ? (
            <div className={cn(
              "flex items-center justify-center h-20 rounded-xl border-2 border-dashed",
              "text-xs text-muted-foreground transition-colors",
              isOver ? "border-primary/40 bg-primary/5 text-primary/70" : "border-border/40"
            )}>
              {isOver ? "Drop here" : "No candidates"}
            </div>
          ) : (
            tasks.map(task => (
              <CandidateKanbanCard
                key={task.id}
                task={task}
                onStageChange={onStageChange}
                isDragging={draggingId === task.id}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

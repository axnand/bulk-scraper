"use client";

import Link from "next/link";
import { Briefcase, Building2, ExternalLink, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { CandidateStage, STAGE_CONFIG, PIPELINE_STAGES } from "./stage-config";

export interface PipelineTask {
  id: string;
  url: string;
  stage: CandidateStage;
  stageUpdatedAt: string;
  name: string;
  headline: string;
  currentOrg: string;
  currentDesignation: string;
  totalExperienceYears: number | null;
  location: string;
  scorePercent: number | null;
  recommendation: string | null;
  profilePictureUrl: string | null;
  publicId: string | null;
  source: string;
  addedAt: string;
}

interface Props {
  task: PipelineTask;
  onStageChange: (taskId: string, newStage: CandidateStage) => void;
  isDragging?: boolean;
}

function getInitials(name: string) {
  return name.split(" ").slice(0, 2).map(n => n[0] ?? "").join("").toUpperCase();
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

export function CandidateKanbanCard({ task, onStageChange, isDragging }: Props) {
  const name = task.name || "Unknown";
  const gradient = pickGradient(name);
  const moveTargets = PIPELINE_STAGES.filter(s => s !== task.stage);

  const scoreCls =
    task.recommendation === "Strong Fit"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
      : task.recommendation === "Moderate Fit"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
      : "border-rose-500/40 bg-rose-500/10 text-rose-500";

  return (
    <div
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("taskId", task.id);
        e.dataTransfer.setData("fromStage", task.stage);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "group relative w-full overflow-hidden bg-background rounded-xl border border-border/60",
        "hover:border-border hover:shadow-sm transition-all duration-150",
        "cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-40 scale-[0.97] shadow-none"
      )}
    >
      <div className="p-3">
        {/* Top: Avatar + Name + Menu */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarImage src={task.profilePictureUrl ?? undefined} alt={name} />
            <AvatarFallback
              className={cn("text-white font-bold text-xs bg-linear-to-br", gradient)}
            >
              {getInitials(name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <Link
              href={`/candidates/${task.id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-sm font-semibold text-foreground truncate leading-snug hover:text-primary hover:underline underline-offset-2 transition-colors block"
            >
              {name}
            </Link>
            <p className="text-sm text-muted-foreground truncate leading-snug">
              {task.currentDesignation || task.headline || "—"}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 h-6 w-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hover:bg-muted">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {moveTargets.map(stage => (
                <DropdownMenuItem
                  key={stage}
                  onClick={() => onStageChange(task.id, stage)}
                  className="gap-2 text-xs cursor-pointer"
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", STAGE_CONFIG[stage].dot)} />
                  {STAGE_CONFIG[stage].label}
                </DropdownMenuItem>
              ))}
              {task.url && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={task.url} target="_blank" rel="noopener noreferrer" className="gap-2 text-xs cursor-pointer">
                      <ExternalLink className="h-3 w-3" />
                      Open LinkedIn
                    </a>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Divider */}
        <div className="my-2.5 border-t border-border/50" />

        {/* Details */}
        <div className="space-y-1.5">
          {task.totalExperienceYears !== null && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Briefcase className="h-3 w-3 shrink-0" />
              <span>{task.totalExperienceYears} yrs experience</span>
            </div>
          )}
          {task.currentOrg && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">Ex: {task.currentOrg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground/60">
            {timeAgo(task.stageUpdatedAt || task.addedAt)}
          </span>
          {task.scorePercent !== null && (
            <Badge
              variant="outline"
              className={cn("text-xs font-bold h-5 px-2 py-0 border rounded-full", scoreCls)}
            >
              {Math.round(task.scorePercent)}%
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

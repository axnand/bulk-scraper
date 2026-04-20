export type CandidateStage =
  | "SOURCED"
  | "SHORTLISTED"
  | "CONTACT_REQUESTED"
  | "CONNECTED"
  | "MESSAGED"
  | "REPLIED"
  | "INTERVIEW"
  | "HIRED"
  | "REJECTED"
  | "ARCHIVED";

export interface StageConfig {
  label: string;
  dot: string;         // Tailwind bg class for the color dot
  headerBg: string;    // subtle header background
  headerText: string;  // text color
  border: string;      // column border color
}

export const STAGE_CONFIG: Record<CandidateStage, StageConfig> = {
  SOURCED: {
    label: "Sourced",
    dot: "bg-slate-400",
    headerBg: "bg-slate-500/10",
    headerText: "text-slate-400",
    border: "border-slate-500/20",
  },
  SHORTLISTED: {
    label: "Shortlisted",
    dot: "bg-emerald-400",
    headerBg: "bg-emerald-500/10",
    headerText: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  CONTACT_REQUESTED: {
    label: "Contacted",
    dot: "bg-amber-400",
    headerBg: "bg-amber-500/10",
    headerText: "text-amber-400",
    border: "border-amber-500/20",
  },
  CONNECTED: {
    label: "Connected",
    dot: "bg-blue-400",
    headerBg: "bg-blue-500/10",
    headerText: "text-blue-400",
    border: "border-blue-500/20",
  },
  MESSAGED: {
    label: "Messaged",
    dot: "bg-indigo-400",
    headerBg: "bg-indigo-500/10",
    headerText: "text-indigo-400",
    border: "border-indigo-500/20",
  },
  REPLIED: {
    label: "Replied",
    dot: "bg-purple-400",
    headerBg: "bg-purple-500/10",
    headerText: "text-purple-400",
    border: "border-purple-500/20",
  },
  INTERVIEW: {
    label: "Interview",
    dot: "bg-violet-400",
    headerBg: "bg-violet-500/10",
    headerText: "text-violet-400",
    border: "border-violet-500/20",
  },
  HIRED: {
    label: "Hired",
    dot: "bg-green-400",
    headerBg: "bg-green-500/10",
    headerText: "text-green-400",
    border: "border-green-500/20",
  },
  REJECTED: {
    label: "Rejected",
    dot: "bg-rose-400",
    headerBg: "bg-rose-500/10",
    headerText: "text-rose-400",
    border: "border-rose-500/20",
  },
  ARCHIVED: {
    label: "Archived",
    dot: "bg-zinc-500",
    headerBg: "bg-zinc-500/10",
    headerText: "text-zinc-500",
    border: "border-zinc-500/20",
  },
};

// Ordered stages shown as columns (HIRED/REJECTED/ARCHIVED shown as overflow)
export const PIPELINE_STAGES: CandidateStage[] = [
  "SOURCED",
  "SHORTLISTED",
  "CONTACT_REQUESTED",
  "CONNECTED",
  "MESSAGED",
  "REPLIED",
  "INTERVIEW",
  "HIRED",
  "REJECTED",
  "ARCHIVED",
];

export const PRIMARY_STAGES: CandidateStage[] = [
  "SOURCED",
  "SHORTLISTED",
  "CONTACT_REQUESTED",
  "CONNECTED",
  "MESSAGED",
  "REPLIED",
  "INTERVIEW",
];

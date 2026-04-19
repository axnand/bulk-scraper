"use client";

import { ReactNode } from "react";
import { ArrowUpDown, Search, MapPin, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Wrapper ────────────────────────────────────────────────────────────────

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap bg-muted/40 border border-border rounded-xl px-3 py-2">
      {children}
    </div>
  );
}

export function FilterDivider() {
  return <div className="h-5 w-px bg-border shrink-0" />;
}

// ─── Pill group (categorical) ────────────────────────────────────────────────

type PillColor = "default" | "emerald" | "amber" | "rose";

interface PillOption {
  label: string;
  value: string;
  color?: PillColor;
}

const pillActive: Record<PillColor, string> = {
  default: "bg-primary/15 text-primary border-primary/30",
  emerald: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  amber: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  rose: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

export function FilterPills({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: PillOption[];
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map(opt => {
        const active = value === opt.value;
        const color = opt.color ?? "default";
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors",
              active ? pillActive[color] : "bg-transparent text-muted-foreground border-transparent hover:border-border hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Text filter ─────────────────────────────────────────────────────────────

export function FilterText({
  value, onChange, placeholder, icon,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  icon?: "search" | "location";
}) {
  const Icon = icon === "location" ? MapPin : Search;
  return (
    <div className="relative">
      <Icon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-background border border-border rounded-lg pl-6 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-36 transition-colors"
      />
    </div>
  );
}

// ─── Number filter ────────────────────────────────────────────────────────────

export function FilterNumber({
  value, onChange, placeholder, min = 0,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
}) {
  return (
    <div className="relative">
      <Briefcase className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        className="bg-background border border-border rounded-lg pl-6 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-28 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

// ─── Sort select ──────────────────────────────────────────────────────────────

interface SortOption {
  label: string;
  value: string;
}

export function SortSelect({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SortOption[];
}) {
  return (
    <div className="relative">
      <ArrowUpDown className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-background border border-border rounded-lg pl-6 pr-6 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer transition-colors"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

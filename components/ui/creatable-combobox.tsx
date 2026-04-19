"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  options?: string[];
  value?: string;
  onChange: (val: string) => void;
  placeholder?: string;
  id?: string;
}

export function CreatableCombobox({ options: optionsProp, value: valueProp, onChange, placeholder, id }: Props) {
  const options = optionsProp ?? [];
  const value = valueProp ?? "";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // commit whatever is typed
        onChange(query.trim());
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [query, onChange]);

  const filtered = options.filter(o => o.toLowerCase().includes(query.toLowerCase()));
  const showAdd = query.trim() && !options.some(o => o.toLowerCase() === query.toLowerCase().trim());

  function select(val: string) {
    onChange(val);
    setQuery(val);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === "Escape") { setOpen(false); }
            if (e.key === "Enter") {
              e.preventDefault();
              if (filtered[0]) select(filtered[0]);
              else if (query.trim()) { onChange(query.trim()); setOpen(false); }
            }
          }}
          className="w-full bg-background border border-input rounded-md px-3 py-2 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
        />
        <ChevronDown
          className={cn("absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-transform cursor-pointer", open && "rotate-180")}
          onClick={() => setOpen(o => !o)}
        />
      </div>

      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md overflow-hidden">
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.map(opt => (
              <li
                key={opt}
                onMouseDown={e => { e.preventDefault(); select(opt); }}
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent text-foreground"
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", value === opt ? "text-primary" : "opacity-0")} />
                {opt}
              </li>
            ))}
            {showAdd && (
              <li
                onMouseDown={e => { e.preventDefault(); select(query.trim()); }}
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent text-primary border-t border-border"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                Add &quot;{query.trim()}&quot;
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

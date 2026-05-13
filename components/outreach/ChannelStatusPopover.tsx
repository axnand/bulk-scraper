"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ThreadForDisplay, deriveThreadDisplay } from "@/lib/channel-display";

// ─── Brand icons ────────────────────────────────────────────────────────────
// Lucide doesn't ship LinkedIn/WhatsApp icons in the installed version.
// These inline SVGs are minimal but recognisable at 14 px.

function LinkedInIcon({ active }: { active: boolean }) {
  const fill = active ? "#0A66C2" : "#9CA3AF";
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill={fill} />
      <rect x="5" y="9" width="3" height="10" fill="white" />
      <circle cx="6.5" cy="6.5" r="1.75" fill="white" />
      <path d="M11 9h3v1.4c.5-.9 1.6-1.6 3-1.6 2.8 0 3.5 1.7 3.5 4.2V19h-3v-5.4c0-1.3-.3-2.1-1.4-2.1-1.3 0-1.6.9-1.6 2.1V19h-3V9z" fill="white" />
    </svg>
  );
}

function GmailIcon({ active }: { active: boolean }) {
  if (!active) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="4" fill="#9CA3AF" />
        <path d="M4 8v10h16V8l-8 5-8-5z" fill="white" opacity="0.9" />
        <path d="M4 8l8 5 8-5H4z" fill="white" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="4" fill="white" />
      <path d="M4 6h16v12H4z" fill="#F2F2F2" />
      <path d="M4 6l8 7 8-7H4z" fill="#EA4335" />
      <path d="M4 6v12h3V9.5L4 6z" fill="#34A853" />
      <path d="M20 6v12h-3V9.5L20 6z" fill="#FBBC05" />
      <path d="M4 18h3V9.5L12 13l5-3.5V18h3" fill="none" stroke="#4285F4" strokeWidth="0" />
      <path d="M7 9.5V18h10V9.5L12 13 7 9.5z" fill="#4285F4" />
    </svg>
  );
}

function WhatsAppIcon({ active }: { active: boolean }) {
  const bg = active ? "#25D366" : "#9CA3AF";
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="12" fill={bg} />
      <path
        d="M12 5.5C8.4 5.5 5.5 8.4 5.5 12c0 1.2.3 2.3.9 3.3L5.5 18.5l3.3-.9c1 .5 2 .8 3.2.8 3.6 0 6.5-2.9 6.5-6.5S15.6 5.5 12 5.5zm3.3 9.1c-.2.5-.9.9-1.3 1-.3.1-.7.1-2.1-.5-1.7-.7-2.9-2.5-3-2.6-.1-.2-.7-.9-.7-1.7 0-.8.4-1.2.6-1.4.2-.2.4-.2.5-.2h.4c.1 0 .3 0 .4.3l.6 1.4c.1.1.1.3 0 .4l-.3.5c-.1.1-.2.3-.1.5.2.3.7 1 1.4 1.6.9.8 1.7 1 2 1.1.2.1.4 0 .5-.1l.5-.6c.1-.2.3-.2.5-.1l1.5.7c.2.1.3.2.3.3-.1.4-.4.9-.7 1.3z"
        fill="white"
      />
    </svg>
  );
}

function ChannelIcon({ channelType, active }: { channelType: string; active: boolean }) {
  if (channelType === "LINKEDIN") return <LinkedInIcon active={active} />;
  if (channelType === "EMAIL") return <GmailIcon active={active} />;
  if (channelType === "WHATSAPP") return <WhatsAppIcon active={active} />;
  return null;
}

// ─── Popover ────────────────────────────────────────────────────────────────

interface Props {
  threads: ThreadForDisplay[];
}

export function ChannelStatusPopover({ threads }: Props) {
  if (threads.length === 0) return null;

  const displays = threads.map(deriveThreadDisplay);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={e => e.stopPropagation()}
            className="h-4 w-4 rounded flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors"
          >
            <Info className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="py-2.5 min-w-[170px] max-w-[220px]"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-0.5">
            Channel Status
          </p>
          <div className="space-y-1.5">
            {displays.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <ChannelIcon channelType={d.channelType} active={d.isActive} />
                <span
                  className={cn(
                    "text-xs leading-none",
                    d.isActive ? "text-popover-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {d.label}
                </span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

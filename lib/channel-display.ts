export type ChannelType = "LINKEDIN" | "EMAIL" | "WHATSAPP";
export type ThreadStatus = "PENDING" | "ACTIVE" | "REPLIED" | "PAUSED" | "ARCHIVED";

export interface ThreadForDisplay {
  channelType: ChannelType;
  status: ThreadStatus;
  providerState: Record<string, unknown> | null;
  lastMessageAt: string | null;
  archivedReason?: string | null;
}

export interface ThreadDisplay {
  channelType: ChannelType;
  label: string;
  isActive: boolean; // true = brand color, false = grey
  archivedReason?: string | null;
}

// Friendly labels for archive reasons emitted by stage-transition and channel
// PATCH. Unknown reasons fall through to their raw value (better than nothing).
const ARCHIVE_REASON_LABELS: Record<string, string> = {
  manual_reset: "Outreach restarted",
  account_changed: "Sending account changed",
  Recruiter_unshortlisted: "Unshortlisted",
  // Free-text reasons from stage-transition cases — startsWith match below.
};

export function describeArchiveReason(raw: string | null | undefined): string {
  if (!raw) return "Archived";
  if (raw in ARCHIVE_REASON_LABELS) return ARCHIVE_REASON_LABELS[raw];
  if (raw.startsWith("Recruiter unshortlisted")) return "Unshortlisted";
  if (raw.startsWith("Recruiter set stage to")) return raw.replace("Recruiter set stage to ", "Moved to ");
  return raw;
}

export function deriveThreadDisplay(thread: ThreadForDisplay): ThreadDisplay {
  const ps = (thread.providerState ?? {}) as Record<string, string>;
  let label: string;
  let isActive: boolean;

  switch (thread.status) {
    case "REPLIED":
      label = "Replied";
      isActive = true;
      break;
    case "ACTIVE":
      if (ps.phase === "INVITE_PENDING") {
        label = "Invite Sent";
      } else if (ps.phase === "CONNECTED" && !thread.lastMessageAt) {
        label = "Connected";
      } else {
        label = "Messaged";
      }
      isActive = true;
      break;
    case "PAUSED":
      label = "Paused";
      isActive = false;
      break;
    case "PENDING":
      label = "Queued";
      isActive = false;
      break;
    case "ARCHIVED":
      label = describeArchiveReason(thread.archivedReason);
      isActive = false;
      break;
    default:
      label = "—";
      isActive = false;
  }

  return {
    channelType: thread.channelType,
    label,
    isActive,
    archivedReason: thread.status === "ARCHIVED" ? thread.archivedReason ?? null : null,
  };
}

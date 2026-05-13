export type ChannelType = "LINKEDIN" | "EMAIL" | "WHATSAPP";
export type ThreadStatus = "PENDING" | "ACTIVE" | "REPLIED" | "PAUSED" | "ARCHIVED";

export interface ThreadForDisplay {
  channelType: ChannelType;
  status: ThreadStatus;
  providerState: Record<string, unknown> | null;
  lastMessageAt: string | null;
}

export interface ThreadDisplay {
  channelType: ChannelType;
  label: string;
  isActive: boolean; // true = brand color, false = grey
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
      label = "Timed Out";
      isActive = false;
      break;
    default:
      label = "—";
      isActive = false;
  }

  return { channelType: thread.channelType, label, isActive };
}

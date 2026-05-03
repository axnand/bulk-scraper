import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";
import { markThreadReplied } from "@/lib/channels/thread-worker";
import { recomputeTaskStage } from "@/lib/channels/stage-rollup";

export const dynamic = "force-dynamic";

// ─── Signature verification ───────────────────────────────────────────────────

async function verifySignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev if not configured

  const sig = req.headers.get("x-unipile-signature") ?? "";
  if (!sig.startsWith("sha256=")) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hex = Array.from(new Uint8Array(mac))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return sig === `sha256=${hex}`;
}

// ─── Webhook event deduplication ─────────────────────────────────────────────
//
// Unipile retries failed deliveries. We deduplicate using WebhookEvent.id
// (the provider's own event ID). Returns true if this is a fresh event.

async function dedupeEvent(provider: string, eventType: string, eventId: string | null): Promise<boolean> {
  if (!eventId) return true; // no id to dedupe on — process it
  try {
    await prisma.webhookEvent.create({
      data: { id: eventId, provider, eventType },
    });
    return true;
  } catch (err: any) {
    if (err.code === "P2002") {
      // Unique constraint = duplicate event — skip
      return false;
    }
    throw err;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!(await verifySignature(req, rawBody))) {
    console.warn("[Webhook/Unipile] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type: string; data: any };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log(`[Webhook/Unipile] event=${event.type} data=${JSON.stringify(event.data)}`);

  // Deduplicate using the most specific available ID
  const eventId =
    event.data?.event_id ??
    event.data?.message_id ??
    event.data?.invitation_id ??
    event.data?.id ??
    null;

  const isDuplicate = !(await dedupeEvent("unipile", event.type, eventId ? `${event.type}:${eventId}` : null));
  if (isDuplicate) {
    console.log(`[Webhook/Unipile] Duplicate event ${event.type}:${eventId} — skipping`);
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "users.new_relation":
      case "users_relations.invitation_accepted":
      case "new_relation":
        await handleInvitationAccepted(event.data);
        break;
      case "messaging.message_received":
      case "messaging.new_message":
      case "message_received":
        await handleNewMessage(event.data);
        break;
      case "mail_received":
      case "emails.mail_received":
        await handleMailReceived(event.data);
        break;
      default:
        console.log(`[Webhook/Unipile] Unhandled event type: ${event.type}`);
    }
  } catch (err: any) {
    console.error(`[Webhook/Unipile] Handler error for ${event.type}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message });
  }

  return NextResponse.json({ ok: true });
}

// ─── Invitation accepted ──────────────────────────────────────────────────────

async function handleInvitationAccepted(data: any) {
  // Try to match a ChannelThread by the stored invitation message ID
  const invitationId = data?.invitation_id ?? data?.id;
  if (invitationId) {
    const threadMsg = await prisma.threadMessage.findFirst({
      where: { providerMessageId: invitationId, type: "INVITE" },
      select: { threadId: true },
    });
    if (threadMsg) {
      await handleThreadInviteAccepted(threadMsg.threadId);
      return;
    }
  }

  // Fallback: scan INVITE_PENDING threads and match by LinkedIn provider_id
  const attendeeProviderId: string | undefined =
    data?.user_provider_id ??
    data?.user_public_identifier ??
    data?.attendee_provider_id ??
    data?.provider_id ??
    data?.attendee?.provider_id;

  if (attendeeProviderId) {
    const accountId = data?.account_id;
    const thread = await findThreadByProviderUserId(attendeeProviderId, accountId);
    if (thread) {
      await handleThreadInviteAccepted(thread.id);
      return;
    }
  }

  console.warn("[Webhook/Unipile] invitation_accepted: could not match any channel thread — payload:", JSON.stringify(data));
}

async function handleThreadInviteAccepted(threadId: string): Promise<void> {
  const thread = await prisma.channelThread.findUnique({
    where: { id: threadId },
    select: { id: true, taskId: true, status: true, providerState: true },
  });
  if (!thread) return;

  const ps = (thread.providerState as Record<string, string> | null) ?? {};
  if (ps.phase !== "INVITE_PENDING") {
    return;
  }

  await prisma.channelThread.update({
    where: { id: threadId },
    data: {
      providerState: { phase: "CONNECTED" },
      nextActionAt: new Date(),
    },
  });

  await recomputeTaskStage(thread.taskId);
  console.log(`[Webhook/Unipile] Thread ${threadId.slice(-6)} → CONNECTED`);
}

async function findThreadByProviderUserId(
  providerUserId: string,
  accountId?: string,
): Promise<{ id: string } | null> {
  const threads = await prisma.channelThread.findMany({
    where: {
      providerState: { path: ["phase"], equals: "INVITE_PENDING" },
      ...(accountId ? { channel: { sendingAccount: { accountId } } } : {}),
    },
    select: {
      id: true,
      task: { select: { result: true } },
    },
  });

  for (const t of threads) {
    try {
      const profile = t.task.result ? JSON.parse(t.task.result as string) : null;
      const pid = profile?.provider_id || profile?.public_identifier;
      if (pid === providerUserId) return { id: t.id };
    } catch { /* skip */ }
  }
  return null;
}

// ─── Inbound message received ─────────────────────────────────────────────────

async function handleNewMessage(data: any) {
  const chatId = data?.chat_id ?? data?.chatId ?? data?.chat?.id;
  // is_from_me/from_me can be absent (treat as inbound), true (outbound echo), or false (inbound)
  const fromMeRaw = data?.is_from_me ?? data?.from_me ?? data?.sender?.is_me;
  const isInbound = fromMeRaw !== true; // absent = inbound; explicit true = outbound

  if (!chatId) {
    console.warn("[Webhook/Unipile] new_message: no chat_id in payload — full data:", JSON.stringify(data));
    return;
  }
  if (!isInbound) {
    console.log(`[Webhook/Unipile] new_message: outbound echo for chatId=${chatId} — ignoring`);
    return;
  }

  const thread = await prisma.channelThread.findFirst({
    where: {
      providerChatId: chatId,
      status: { in: ["ACTIVE", "PENDING"] },
    },
    select: { id: true, taskId: true },
  });

  if (thread) {
    await markThreadReplied(thread.id, thread.taskId);
    await recomputeTaskStage(thread.taskId);
    console.log(`[Webhook/Unipile] Thread ${thread.id.slice(-6)} → REPLIED`);
    return;
  }

  console.log(`[Webhook/Unipile] new_message: no active thread for chatId=${chatId} — ignoring`);
}

// ─── Inbound email received (Gmail / Outlook) ─────────────────────────────────

async function handleMailReceived(data: any) {
  // Unipile sets in_reply_to.id to the Unipile provider_id of the parent email
  const inReplyToId: string | undefined =
    data?.in_reply_to?.id ??
    data?.in_reply_to?.message_id;

  if (!inReplyToId) {
    // Not a reply — a fresh inbound email, nothing to match against
    return;
  }

  // providerThreadId holds the provider_id of the email we sent (stored at send time)
  const thread = await prisma.channelThread.findFirst({
    where: {
      providerThreadId: inReplyToId,
      status: { in: ["ACTIVE", "PENDING"] },
    },
    select: { id: true, taskId: true },
  });

  if (thread) {
    await markThreadReplied(thread.id, thread.taskId);
    await recomputeTaskStage(thread.taskId);
    console.log(`[Webhook/Unipile] Email thread ${thread.id.slice(-6)} → REPLIED`);
    return;
  }

  console.log(`[Webhook/Unipile] mail_received: no active email thread for in_reply_to=${inReplyToId} — ignoring`);
}

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";
import { extractIdentifier } from "@/lib/services/unipile.service";

export const dynamic = "force-dynamic";

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

  try {
    switch (event.type) {
      // Unipile source=users event=new_relation (invite accepted / new connection)
      case "users.new_relation":
      // Legacy / alternate formats kept for safety
      case "users_relations.invitation_accepted":
      case "new_relation":
        await handleInvitationAccepted(event.data);
        break;
      // Unipile source=messaging event=message_received
      case "messaging.message_received":
      case "messaging.new_message":
      case "message_received":
        await handleNewMessage(event.data);
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

/**
 * Resolve which OutreachMessage / task corresponds to this acceptance.
 *
 * Strategy (in order):
 * 1. Match by providerMessageId (invitation_id stored when invite was sent)
 * 2. Fallback: match by account_id + attendee provider_id stored in task result
 */
async function resolveInviteMsg(data: any) {
  const invitationId = data?.invitation_id ?? data?.id;

  // Strategy 1 — direct match on stored invitation_id
  if (invitationId) {
    const msg = await prisma.outreachMessage.findFirst({
      where: { providerMessageId: invitationId },
      include: { campaign: { include: { sendingAccount: true } }, task: true },
    });
    if (msg) return msg;
    console.warn(`[Webhook/Unipile] invitation_id=${invitationId} not found — trying fallback`);
  }

  // Strategy 2 — match by Unipile account + attendee provider_id
  // users.new_relation payload fields: account_id, user_provider_id, user_public_identifier
  const accountId = data?.account_id;
  const attendeeProviderId: string | undefined =
    data?.user_provider_id ??
    data?.user_public_identifier ??
    data?.attendee_provider_id ??
    data?.provider_id ??
    data?.attendee?.provider_id;

  if (!accountId || !attendeeProviderId) return null;

  // Find CONTACT_REQUESTED tasks whose scraped profile contains this provider_id
  const candidates = await prisma.task.findMany({
    where: {
      stage: "CONTACT_REQUESTED",
      outreachMessages: {
        some: {
          channel: "LINKEDIN_INVITE",
          status: "SENT",
          campaign: { sendingAccount: { accountId } }
        }
      }
    },
    select: {
      id: true,
      stage: true,
      result: true,
      url: true,
      outreachMessages: {
        where: { channel: "LINKEDIN_INVITE", status: "SENT" },
        include: { campaign: { include: { sendingAccount: true } } },
        take: 1,
      },
    },
  });

  for (const task of candidates) {
    try {
      const profile = task.result ? JSON.parse(task.result) : null;
      
      const pids = [
        profile?.provider_id,
        profile?.public_identifier,
        task.url ? extractIdentifier(task.url) : null,
        task.url ? task.url.match(/linkedin\.com\/in\/([^\/\?]+)/)?.[1] : null
      ].filter(Boolean);

      if (attendeeProviderId && pids.includes(attendeeProviderId) && task.outreachMessages.length > 0) {
        const omsg = task.outreachMessages[0];
        return {
          ...omsg,
          task,
          campaign: omsg.campaign,
        } as any;
      }
    } catch { /* invalid JSON — skip */ }
  }

  return null;
}

/**
 * invitation_accepted → CONTACT_REQUESTED → CONNECTED, then auto-send follow-up DM.
 */
async function handleInvitationAccepted(data: any) {
  const msg = await resolveInviteMsg(data);

  if (!msg) {
    console.warn("[Webhook/Unipile] invitation_accepted: could not match any task — payload:", JSON.stringify(data));
    return;
  }

  if (msg.task.stage !== "CONTACT_REQUESTED") {
    console.log(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)} already at ${msg.task.stage} — skipping`);
    return;
  }

  const now = new Date();

  // Step 1 — move to CONNECTED (its own transaction, always succeeds)
  await prisma.$transaction([
    prisma.task.update({
      where: { id: msg.taskId },
      data: { stage: "CONNECTED" as CandidateStage, stageUpdatedAt: now },
    }),
    prisma.stageEvent.create({
      data: {
        taskId: msg.taskId,
        fromStage: "CONTACT_REQUESTED" as CandidateStage,
        toStage: "CONNECTED" as CandidateStage,
        actor: "SYSTEM",
        reason: "LinkedIn invitation accepted (webhook)",
      },
    }),
  ]);

  console.log(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)} → CONNECTED`);

  // Step 2 — queue follow-up DM (separate operation, won't roll back stage change on failure)
  let dmBody = "";
  try {
    const tpl = JSON.parse(msg.campaign.template);
    // Try "body" first (explicit DM template), fall back to inviteNote
    dmBody = tpl?.body ?? tpl?.inviteNote ?? "";
  } catch { /* no template */ }

  if (!dmBody.trim()) {
    console.log(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)}: no DM body in campaign — skipping auto-DM`);
    return;
  }

  try {
    // Upsert to handle the @@unique([campaignId, taskId]) constraint gracefully
    await prisma.outreachMessage.upsert({
      where: { campaignId_taskId: { campaignId: msg.campaignId, taskId: msg.taskId } },
      create: {
        campaignId: msg.campaignId,
        taskId: msg.taskId,
        channel: "LINKEDIN_DM",
        status: "APPROVED",
        renderedBody: dmBody,
        approvedAt: now,
        scheduledFor: now,
      },
      update: {
        channel: "LINKEDIN_DM",
        status: "APPROVED",
        renderedBody: dmBody,
        approvedAt: now,
        scheduledFor: now,
      },
    });

    console.log(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)}: DM queued — triggering worker`);

    // Trigger outreach worker in the background so DM goes out immediately
    after(async () => {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (!appUrl) return;
      await fetch(`${appUrl}/api/process-outreach`, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      }).catch(err => console.warn("[Webhook/Unipile] Worker trigger failed:", err.message));
    });
  } catch (err: any) {
    console.error(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)}: failed to queue DM:`, err.message);
  }
}

/**
 * messaging.new_message (inbound) → MESSAGED/CONNECTED → REPLIED.
 */
async function handleNewMessage(data: any) {
  const chatId = data?.chat_id ?? data?.chatId;
  const isInbound = data?.is_from_me === false || data?.from_me === false;
  const body = data?.text ?? data?.body ?? "";

  if (!chatId) {
    console.warn("[Webhook/Unipile] new_message: no chat_id in payload");
    return;
  }

  if (!isInbound) return; // outbound echo — ignore

  const msg = await prisma.outreachMessage.findFirst({
    where: { providerChatId: chatId },
    include: { task: { select: { id: true, stage: true } } },
  });

  if (!msg) {
    console.log(`[Webhook/Unipile] new_message: no OutreachMessage for chatId=${chatId} — ignoring`);
    return;
  }

  const now = new Date();
  const fromStage = msg.task.stage;

  // Record the inbound message
  await prisma.outreachMessage.create({
    data: {
      campaignId: msg.campaignId,
      taskId: msg.taskId,
      channel: "LINKEDIN_DM",
      status: "REPLIED",
      renderedBody: "",
      direction: "IN",
      inboundBody: body,
      providerChatId: chatId,
      sentAt: now,
    },
  });

  // Advance from MESSAGED or CONNECTED → REPLIED
  if (fromStage !== "MESSAGED" && fromStage !== "CONNECTED") {
    console.log(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)} at ${fromStage} — inbound recorded, stage unchanged`);
    return;
  }

  await prisma.$transaction([
    prisma.task.update({
      where: { id: msg.taskId },
      data: { stage: "REPLIED" as CandidateStage, stageUpdatedAt: now },
    }),
    prisma.stageEvent.create({
      data: {
        taskId: msg.taskId,
        fromStage,
        toStage: "REPLIED" as CandidateStage,
        actor: "SYSTEM",
        reason: "Inbound LinkedIn message received (webhook)",
      },
    }),
  ]);

  console.log(`[Webhook/Unipile] Task ${msg.taskId.slice(-6)} → REPLIED`);
}

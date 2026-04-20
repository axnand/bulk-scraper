import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendInvitation, startChat } from "@/lib/services/unipile.service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function runOutreachCycle(): Promise<{ sent: number; failed: number; remaining: number }> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Load approved messages that are due
  const messages = await prisma.outreachMessage.findMany({
    where: {
      status: "APPROVED",
      scheduledFor: { lte: now },
    },
    include: {
      campaign: { include: { sendingAccount: true } },
      task: { select: { id: true, url: true, result: true, stage: true } },
    },
    orderBy: { scheduledFor: "asc" },
    take: 50,
  });

  if (messages.length === 0) {
    return { sent: 0, failed: 0, remaining: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const msg of messages) {
    const campaign = msg.campaign;
    const account = campaign.sendingAccount;
    if (!account) {
      console.warn(`[Outreach] Message ${msg.id.slice(-6)}: no sending account — skipping`);
      continue;
    }

    // Enforce daily cap per campaign
    const todaySent = await prisma.outreachMessage.count({
      where: {
        campaignId: campaign.id,
        status: "SENT",
        sentAt: { gte: todayStart },
      },
    });
    if (todaySent >= campaign.dailyCap) {
      console.log(`[Outreach] Campaign ${campaign.id.slice(-6)} hit daily cap (${todaySent}/${campaign.dailyCap}) — skipping remaining messages`);
      break;
    }

    const profile = msg.task.result ? JSON.parse(msg.task.result) : null;
    const providerUserId: string | null =
      profile?.provider_id ||
      profile?.public_identifier ||
      null;

    if (!providerUserId) {
      await prisma.outreachMessage.update({
        where: { id: msg.id },
        data: { status: "FAILED", errorMessage: "Could not resolve provider ID" },
      });
      failed++;
      continue;
    }

    try {
      const acctDsn = account.dsn ?? undefined;
      const acctKey = account.apiKey ?? undefined;
      let providerMessageId: string | null = null;
      let providerChatId: string | null = null;

      // Use the message's own channel to decide send method — not the campaign channel,
      // because follow-up DMs are queued with channel=LINKEDIN_DM on LINKEDIN_INVITE campaigns.
      if (msg.channel === "LINKEDIN_INVITE") {
        const { invitationId } = await sendInvitation({
          accountId: account.accountId,
          providerUserId,
          message: msg.renderedBody || undefined,
          accountDsn: acctDsn,
          accountApiKey: acctKey,
        });
        providerMessageId = invitationId || null;
      } else {
        // LINKEDIN_DM — start a new chat with the first message
        const { chatId, messageId } = await startChat({
          accountId: account.accountId,
          providerUserId,
          text: msg.renderedBody,
          accountDsn: acctDsn,
          accountApiKey: acctKey,
        });
        providerChatId = chatId || null;
        providerMessageId = messageId || null;
      }

      // Advance to MESSAGED for any DM sent, as long as we haven't already passed that stage
      const TERMINAL_STAGES = ["MESSAGED", "REPLIED", "INTERVIEW", "HIRED", "REJECTED", "ARCHIVED"];
      const isDm = msg.channel === "LINKEDIN_DM";
      const advanceToMessaged = isDm && !TERMINAL_STAGES.includes(msg.task.stage);
      const toStage = advanceToMessaged ? "MESSAGED" : msg.task.stage;

      await prisma.$transaction([
        prisma.outreachMessage.update({
          where: { id: msg.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            providerMessageId,
            providerChatId,
          },
        }),
        ...(advanceToMessaged
          ? [prisma.task.update({
              where: { id: msg.taskId },
              data: { stage: "MESSAGED", stageUpdatedAt: new Date() },
            })]
          : []),
        prisma.stageEvent.create({
          data: {
            taskId: msg.taskId,
            fromStage: msg.task.stage,
            toStage,
            actor: "SYSTEM",
            reason: `${campaign.channel} message sent`,
          },
        }),
      ]);

      sent++;
      console.log(`[Outreach] Sent message ${msg.id.slice(-6)} via ${campaign.channel}`);
    } catch (err: any) {
      console.error(`[Outreach] Message ${msg.id.slice(-6)} failed: ${err.message}`);
      await prisma.outreachMessage.update({
        where: { id: msg.id },
        data: {
          status: "FAILED",
          errorMessage: err.message,
          retryCount: { increment: 1 },
        },
      });
      failed++;
    }
  }

  const remaining = await prisma.outreachMessage.count({
    where: { status: "APPROVED", scheduledFor: { lte: new Date() } },
  });

  console.log(`[Outreach] Cycle done — sent=${sent} failed=${failed} remaining=${remaining}`);
  return { sent, failed, remaining };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      const result = await runOutreachCycle();
      // Self-chain if more work remains
      if (result.remaining > 0) {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/process-outreach`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
        }).catch(err => console.warn("[Outreach] Self-chain failed:", err.message));
      }
    } catch (err: any) {
      console.error("[Outreach] after() crashed:", err.message);
    }
  });

  return NextResponse.json({ message: "Outreach processing started" });
}

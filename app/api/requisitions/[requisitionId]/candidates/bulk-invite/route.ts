import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendInvitation, extractIdentifier } from "@/lib/services/unipile.service";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> },
) {
  try {
    const { requisitionId: rawReqId } = await params;
    const requisitionId = await resolveRequisitionId(rawReqId);
    const { taskIds, campaignId: requestedCampaignId } = (await req.json()) as { taskIds: string[]; campaignId?: string };

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ error: "taskIds array required" }, { status: 400 });
    }
    if (taskIds.length > 50) {
      return NextResponse.json({ error: "Maximum 50 tasks per batch" }, { status: 400 });
    }

    // Find active campaign once
    const campaign = await prisma.campaign.findFirst({
      where: {
        ...(requestedCampaignId ? { id: requestedCampaignId } : {}),
        requisitionId,
        status: "ACTIVE",
        channel: { in: ["LINKEDIN_INVITE", "LINKEDIN_DM"] },
      },
      include: { sendingAccount: true },
      orderBy: { createdAt: "desc" },
    });

    if (!campaign?.sendingAccount) {
      return NextResponse.json(
        { error: "No active LinkedIn campaign with a sending account configured" },
        { status: 400 },
      );
    }

    let inviteNote: string | undefined;
    try {
      const tpl = JSON.parse(campaign.template);
      inviteNote = typeof tpl?.inviteNote === "string" ? tpl.inviteNote.slice(0, 300) : undefined;
    } catch { /* ignore */ }

    // Load SHORTLISTED tasks only
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds }, stage: "SHORTLISTED" },
      select: {
        id: true,
        url: true,
        result: true,
        stage: true,
        outreachMessages: { select: { id: true, campaignId: true } },
      },
    });

    const results: { taskId: string; ok: boolean; error?: string }[] = [];
    let sent = 0;

    for (const task of tasks) {
      try {
        const profile = task.result ? JSON.parse(task.result) : null;
        const providerUserId =
          profile?.provider_id ||
          profile?.public_identifier ||
          extractIdentifier(task.url);

        if (!providerUserId) {
          results.push({ taskId: task.id, ok: false, error: "Could not resolve LinkedIn ID" });
          continue;
        }

        const { invitationId } = await sendInvitation({
          accountId: campaign.sendingAccount!.accountId,
          providerUserId,
          message: inviteNote,
          accountDsn: campaign.sendingAccount!.dsn ?? undefined,
          accountApiKey: campaign.sendingAccount!.apiKey ?? undefined,
        });

        const now = new Date();
        const existingMsg = task.outreachMessages.find(m => m.campaignId === campaign.id);

        await prisma.$transaction([
          prisma.task.update({
            where: { id: task.id },
            data: { stage: "CONTACT_REQUESTED", stageUpdatedAt: now },
          }),
          existingMsg
            ? prisma.outreachMessage.update({
                where: { id: existingMsg.id },
                data: { status: "SENT", sentAt: now, providerMessageId: invitationId || null },
              })
            : prisma.outreachMessage.create({
                data: {
                  campaignId: campaign.id,
                  taskId: task.id,
                  channel: "LINKEDIN_INVITE",
                  status: "SENT",
                  renderedBody: inviteNote ?? "",
                  approvedAt: now,
                  sentAt: now,
                  providerMessageId: invitationId || null,
                },
              }),
          prisma.stageEvent.create({
            data: {
              taskId: task.id,
              fromStage: "SHORTLISTED",
              toStage: "CONTACT_REQUESTED",
              actor: "USER",
              reason: "LinkedIn invitation sent (bulk)",
            },
          }),
        ]);

        results.push({ taskId: task.id, ok: true });
        sent++;
      } catch (err: any) {
        results.push({ taskId: task.id, ok: false, error: err.message });
      }
    }

    return NextResponse.json({ sent, failed: results.filter(r => !r.ok).length, results });
  } catch (error: any) {
    console.error("[bulk-invite] failed:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

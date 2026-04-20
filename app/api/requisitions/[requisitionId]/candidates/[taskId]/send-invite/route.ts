import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendInvitation, extractIdentifier } from "@/lib/services/unipile.service";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string; taskId: string }> },
) {
  try {
    const { requisitionId: rawReqId, taskId } = await params;
    const requisitionId = await resolveRequisitionId(rawReqId);

    const body = await req.json().catch(() => ({})) as { campaignId?: string };
    const requestedCampaignId = body?.campaignId;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        url: true,
        stage: true,
        result: true,
        outreachMessages: {
          select: { id: true, campaignId: true, status: true },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.stage !== "SHORTLISTED") {
      return NextResponse.json(
        { error: `Expected stage SHORTLISTED, got ${task.stage}` },
        { status: 409 },
      );
    }

    const profile = task.result ? JSON.parse(task.result) : null;
    const providerUserId: string | null =
      profile?.provider_id ||
      profile?.public_identifier ||
      extractIdentifier(task.url);

    if (!providerUserId) {
      return NextResponse.json(
        { error: "Could not resolve LinkedIn provider ID for this candidate" },
        { status: 422 },
      );
    }

    // Use the requested campaign if provided, otherwise pick first active
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

    if (!campaign) {
      return NextResponse.json(
        { error: "No active LinkedIn campaign found for this requisition" },
        { status: 400 },
      );
    }

    if (!campaign.sendingAccount) {
      return NextResponse.json(
        { error: "Campaign has no sending account configured" },
        { status: 400 },
      );
    }

    let inviteNote: string | undefined;
    try {
      const tpl = JSON.parse(campaign.template);
      inviteNote = typeof tpl?.inviteNote === "string" ? tpl.inviteNote.slice(0, 300) : undefined;
    } catch { /* ignore */ }

    const { invitationId } = await sendInvitation({
      accountId: campaign.sendingAccount.accountId,
      providerUserId,
      message: inviteNote,
      accountDsn: campaign.sendingAccount.dsn ?? undefined,
      accountApiKey: campaign.sendingAccount.apiKey ?? undefined,
    });

    const now = new Date();
    const existingMsg = task.outreachMessages.find(m => m.campaignId === campaign.id);

    await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
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
              taskId,
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
          taskId,
          fromStage: "SHORTLISTED",
          toStage: "CONTACT_REQUESTED",
          actor: "USER",
          reason: `LinkedIn invitation sent via campaign "${campaign.name}"`,
        },
      }),
    ]);

    return NextResponse.json({ ok: true, invitationId, campaignId: campaign.id });
  } catch (error: any) {
    console.error("[send-invite] failed:", error);
    const message = error?.message || "Internal server error";
    const status = error?.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

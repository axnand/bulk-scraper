import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startChat, extractIdentifier } from "@/lib/services/unipile.service";
import { resolveRequisitionId } from "@/lib/resolve-requisition";
import { buildVars, renderTemplate } from "@/lib/outreach/render-template";

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

    // Find active DM campaign (prefer LINKEDIN_DM, fall back to any active)
    const campaign = await prisma.campaign.findFirst({
      where: {
        ...(requestedCampaignId ? { id: requestedCampaignId } : {}),
        requisitionId,
        status: "ACTIVE",
        channel: { in: ["LINKEDIN_DM", "LINKEDIN_INVITE"] },
      },
      include: { sendingAccount: true },
      orderBy: [{ channel: "desc" }, { createdAt: "desc" }],
    });

    if (!campaign?.sendingAccount) {
      return NextResponse.json(
        { error: "No active LinkedIn campaign with a sending account configured" },
        { status: 400 },
      );
    }

    let dmBody = "";
    try {
      const tpl = JSON.parse(campaign.template);
      dmBody = tpl?.body ?? tpl?.inviteNote ?? "";
    } catch { /* ignore */ }

    if (!dmBody.trim()) {
      return NextResponse.json(
        { error: "Campaign has no message template configured. Add a DM body in Campaign settings." },
        { status: 400 },
      );
    }

    // Load CONNECTED tasks only
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds }, stage: "CONNECTED" },
      select: { id: true, url: true, result: true, analysisResult: true, stage: true },
    });

    const results: { taskId: string; ok: boolean; error?: string }[] = [];
    let queued = 0;

    for (const task of tasks) {
      try {
        const profile = task.result ? JSON.parse(task.result) : null;
        const analysis = task.analysisResult ? JSON.parse(task.analysisResult) : null;
        const providerUserId =
          profile?.provider_id ||
          profile?.public_identifier ||
          extractIdentifier(task.url);

        if (!providerUserId) {
          results.push({ taskId: task.id, ok: false, error: "Could not resolve LinkedIn ID" });
          continue;
        }

        const vars = buildVars(profile, analysis);
        const rendered = renderTemplate(dmBody, vars);

        const { chatId, messageId } = await startChat({
          accountId: campaign.sendingAccount!.accountId,
          providerUserId,
          text: rendered,
          accountDsn: campaign.sendingAccount!.dsn ?? undefined,
          accountApiKey: campaign.sendingAccount!.apiKey ?? undefined,
        });

        const now = new Date();

        await prisma.$transaction([
          prisma.task.update({
            where: { id: task.id },
            data: { stage: "MESSAGED", stageUpdatedAt: now },
          }),
          prisma.stageEvent.create({
            data: {
              taskId: task.id,
              fromStage: "CONNECTED",
              toStage: "MESSAGED",
              actor: "USER",
              reason: "LinkedIn DM sent (bulk)",
            },
          }),
        ]);

        // Track the message — upsert to handle pre-existing (campaignId, taskId) record
        await prisma.outreachMessage.upsert({
          where: { campaignId_taskId: { campaignId: campaign.id, taskId: task.id } },
          create: {
            campaignId: campaign.id,
            taskId: task.id,
            channel: "LINKEDIN_DM",
            status: "SENT",
            renderedBody: rendered,
            approvedAt: now,
            sentAt: now,
            providerChatId: chatId || null,
            providerMessageId: messageId || null,
          },
          update: {
            channel: "LINKEDIN_DM",
            status: "SENT",
            renderedBody: rendered,
            sentAt: now,
            providerChatId: chatId || null,
            providerMessageId: messageId || null,
          },
        });

        results.push({ taskId: task.id, ok: true });
        queued++;
      } catch (err: any) {
        results.push({ taskId: task.id, ok: false, error: err.message });
      }
    }

    return NextResponse.json({ queued, failed: results.filter(r => !r.ok).length, results });
  } catch (error: any) {
    console.error("[bulk-message] failed:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

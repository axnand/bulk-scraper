import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startChat, extractIdentifier } from "@/lib/services/unipile.service";
import { buildVars, renderTemplate } from "@/lib/outreach/render-template";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string; taskId: string }> },
) {
  try {
    const { requisitionId: rawReqId, taskId } = await params;
    const requisitionId = await resolveRequisitionId(rawReqId);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, url: true, stage: true, result: true, analysisResult: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.stage !== "CONNECTED") {
      return NextResponse.json(
        { error: `Expected stage CONNECTED, got ${task.stage}` },
        { status: 409 },
      );
    }

    const profile = task.result ? JSON.parse(task.result) : null;
    const analysis = task.analysisResult ? JSON.parse(task.analysisResult) : null;
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

    const channel = await prisma.channel.findFirst({
      where: { requisitionId, type: "LINKEDIN", status: { in: ["ACTIVE", "PAUSED"] } },
      include: { sendingAccount: true },
      orderBy: { createdAt: "desc" },
    });

    if (!channel) {
      return NextResponse.json(
        { error: "No LinkedIn channel for this requisition" },
        { status: 400 },
      );
    }

    const account = channel.sendingAccount;
    if (!account) {
      return NextResponse.json(
        { error: "Channel has no sending account configured" },
        { status: 400 },
      );
    }

    const cfg = channel.config as any;
    const firstFollowup = cfg?.followups?.[0];
    if (!firstFollowup?.template) {
      return NextResponse.json(
        { error: "No first-DM template configured on the LinkedIn channel (followups[0])" },
        { status: 400 },
      );
    }

    const vars = buildVars(profile ?? {}, analysis ?? {});
    const text = renderTemplate(firstFollowup.template, vars);

    const { chatId, messageId } = await startChat({
      accountId: account.accountId,
      providerUserId,
      text,
      accountDsn: account.dsn ?? undefined,
      accountApiKey: account.apiKey ?? undefined,
    });

    const now = new Date();

    await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: { stage: "MESSAGED", stageUpdatedAt: now },
      }),
      prisma.outreachMessage.create({
        data: {
          campaignId: `${channel.id}:dm`,
          taskId,
          channel: "LINKEDIN_DM",
          status: "SENT",
          renderedBody: text,
          approvedAt: now,
          sentAt: now,
          providerMessageId: messageId || null,
          providerChatId: chatId || null,
        },
      }),
      prisma.stageEvent.create({
        data: {
          taskId,
          fromStage: "CONNECTED",
          toStage: "MESSAGED",
          actor: "USER",
          reason: "LinkedIn first DM sent",
        },
      }),
    ]);

    return NextResponse.json({ ok: true, chatId, messageId });
  } catch (error: any) {
    console.error("[send-dm] failed:", error);
    const message = error?.message || "Internal server error";
    const status = error?.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

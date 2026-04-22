import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await params;
    const body = await req.json();

    const {
      name,
      channel,
      template,
      threshold,
      approvalMode,
      dailyCap,
      sendingAccountId,
      status,
    } = body as Record<string, any>;

    const data: Record<string, any> = {};
    if (name !== undefined) data.name = name.trim();
    if (channel !== undefined) data.channel = channel;
    if (template !== undefined) data.template = template ? JSON.stringify(template) : template;
    if (threshold !== undefined) data.threshold = threshold ? JSON.stringify(threshold) : threshold;
    if (approvalMode !== undefined) data.approvalMode = approvalMode;
    if (dailyCap !== undefined) data.dailyCap = Number(dailyCap);
    if (sendingAccountId !== undefined) data.sendingAccountId = sendingAccountId ?? null;
    if (status !== undefined) data.status = status;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const campaign = await prisma.campaign.update({
      where: { id: campaignId },
      data,
    });

    return NextResponse.json({ campaign });
  } catch (error: any) {
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    console.error("[Campaign] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  try {
    const { campaignId } = await params;
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "ARCHIVED" },
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    console.error("[Campaign] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> },
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);

    const campaigns = await prisma.campaign.findMany({
      where: { requisitionId, status: { not: "ARCHIVED" } },
      include: {
        sendingAccount: { select: { id: true, accountId: true, name: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("[Campaigns] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> },
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);

    const body = await req.json();
    const {
      name,
      channel = "LINKEDIN_INVITE",
      template,
      threshold,
      approvalMode = "REVIEW",
      dailyCap = 20,
      sendingAccountId,
      status = "DRAFT",
    } = body as {
      name: string;
      channel?: string;
      template: Record<string, unknown>;
      threshold: { minScorePercent: number };
      approvalMode?: string;
      dailyCap?: number;
      sendingAccountId?: string;
      status?: string;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!template) {
      return NextResponse.json({ error: "template is required" }, { status: 400 });
    }
    if (typeof threshold?.minScorePercent !== "number") {
      return NextResponse.json({ error: "threshold.minScorePercent is required" }, { status: 400 });
    }

    const campaign = await prisma.campaign.create({
      data: {
        requisitionId,
        name: name.trim(),
        channel,
        template: JSON.stringify(template),
        threshold: JSON.stringify(threshold),
        approvalMode,
        dailyCap,
        sendingAccountId: sendingAccountId ?? null,
        status,
      },
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    console.error("[Campaigns] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

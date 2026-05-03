import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  validateLinkedInConfig,
  validateEmailConfig,
  validateWAConfig,
} from "@/lib/channels/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const { channelId } = await params;

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: {
        sendingAccount: { select: { id: true, accountId: true, name: true } },
        _count: { select: { threads: true } },
      },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    return NextResponse.json({ channel });
  } catch (err) {
    console.error("[Channel] GET failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const { channelId } = await params;
    const body = await req.json() as Record<string, unknown>;

    const data: Record<string, unknown> = {};

    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.status !== undefined) data.status = body.status;
    if (body.sendingAccountId !== undefined) data.sendingAccountId = body.sendingAccountId ?? null;
    if (body.dailyCap !== undefined) data.dailyCap = Number(body.dailyCap);
    if (body.dailyInMailCap !== undefined) data.dailyInMailCap = Number(body.dailyInMailCap);

    // Look up the channel once if we'll need to validate config or sending account.
    const needExisting = body.config !== undefined || body.sendingAccountId !== undefined;
    const existing = needExisting
      ? await prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } })
      : null;
    if (needExisting && !existing) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    if (body.config !== undefined) {
      // Re-validate config when updating
      const validation =
        existing!.type === "LINKEDIN" ? validateLinkedInConfig(body.config)
        : existing!.type === "EMAIL"  ? validateEmailConfig(body.config)
        :                               validateWAConfig(body.config);

      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      data.config = body.config as object;
    }

    // EC-9.10 / Phase 3 #12 — same type-match check on PATCH. Allow null
    // (clearing the sender), but reject any account whose type doesn't match
    // the channel type or whose status is DISABLED.
    if (body.sendingAccountId !== undefined && body.sendingAccountId !== null) {
      const acct = await prisma.account.findUnique({
        where: { id: String(body.sendingAccountId) },
        select: { id: true, type: true, status: true, deletedAt: true },
      });
      if (!acct || acct.deletedAt) {
        return NextResponse.json(
          { error: `sendingAccountId ${body.sendingAccountId} not found` },
          { status: 400 },
        );
      }
      if (acct.type !== existing!.type) {
        return NextResponse.json(
          { error: `Account type ${acct.type} does not match channel type ${existing!.type}` },
          { status: 400 },
        );
      }
      if (acct.status === "DISABLED") {
        return NextResponse.json(
          { error: `Sending account is DISABLED — pick a different account` },
          { status: 400 },
        );
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const channel = await prisma.channel.update({
      where: { id: channelId },
      data,
    });

    return NextResponse.json({ channel });
  } catch (err: any) {
    if (err.code === "P2025") {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    console.error("[Channel] PATCH failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const { channelId } = await params;

    await prisma.channel.update({
      where: { id: channelId },
      data: { status: "ARCHIVED" },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err.code === "P2025") {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    console.error("[Channel] DELETE failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

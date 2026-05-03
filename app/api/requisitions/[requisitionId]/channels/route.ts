import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRequisitionId } from "@/lib/resolve-requisition";
import { AccountType, ChannelType } from "@prisma/client";
import {
  validateLinkedInConfig,
  validateEmailConfig,
  validateWAConfig,
} from "@/lib/channels/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> },
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);

    const channels = await prisma.channel.findMany({
      where: { requisitionId, status: { not: "ARCHIVED" } },
      include: {
        sendingAccount: { select: { id: true, accountId: true, name: true } },
        _count: { select: { threads: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ channels });
  } catch (err) {
    console.error("[Channels] GET failed:", err);
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
      type,
      config,
      sendingAccountId,
      dailyCap = 20,
      dailyInMailCap = 5,
    } = body as {
      name?: string;
      type?: string;
      config?: unknown;
      sendingAccountId?: string;
      dailyCap?: number;
      dailyInMailCap?: number;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!type || !["LINKEDIN", "EMAIL", "WHATSAPP"].includes(type)) {
      return NextResponse.json(
        { error: "type must be LINKEDIN | EMAIL | WHATSAPP" },
        { status: 400 },
      );
    }
    if (!config) {
      return NextResponse.json({ error: "config is required" }, { status: 400 });
    }

    // Validate config shape against the channel type
    const validation =
      type === "LINKEDIN" ? validateLinkedInConfig(config)
      : type === "EMAIL"    ? validateEmailConfig(config)
      :                       validateWAConfig(config);

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // EC-9.10 / Phase 3 #12 — refuse a sending account whose type doesn't
    // match the channel type (e.g., assigning an EMAIL account to a LINKEDIN
    // channel would loop forever in the worker because the runtime API
    // calls would 4xx with the wrong credentials).
    if (sendingAccountId) {
      const acct = await prisma.account.findUnique({
        where: { id: sendingAccountId },
        select: { id: true, type: true, status: true, deletedAt: true },
      });
      if (!acct || acct.deletedAt) {
        return NextResponse.json(
          { error: `sendingAccountId ${sendingAccountId} not found` },
          { status: 400 },
        );
      }
      if ((acct.type as AccountType) !== (type as AccountType)) {
        return NextResponse.json(
          { error: `Account type ${acct.type} does not match channel type ${type}` },
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

    const channel = await prisma.channel.create({
      data: {
        requisitionId,
        name: name.trim(),
        type: type as ChannelType,
        config: config as object,
        sendingAccountId: sendingAccountId ?? null,
        dailyCap,
        dailyInMailCap,
      },
    });

    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    console.error("[Channels] POST failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

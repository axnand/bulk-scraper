// ─── Per-channel account pool admin ──────────────────────────────────────────
//
// CRUD over ChannelAccountPool (P1 #14): a list of allowed sending accounts
// per channel. Fan-out picks one of these for each new ChannelThread; an
// empty pool falls back to channel.sendingAccount (legacy single-account
// binding).
//
// GET    /api/requisitions/:rid/channels/:cid/pool        — list
// POST   /api/requisitions/:rid/channels/:cid/pool        — add { accountId, priority?, weight? }
// DELETE /api/requisitions/:rid/channels/:cid/pool?accountId=… — remove

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const { channelId } = await params;
    const pool = await prisma.channelAccountPool.findMany({
      where: { channelId },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      include: {
        account: {
          select: {
            id: true,
            accountId: true,
            name: true,
            type: true,
            status: true,
            deletedAt: true,
            dailyCount: true,
            weeklyCount: true,
            warmupUntil: true,
          },
        },
      },
    });
    return NextResponse.json({ pool });
  } catch (err) {
    console.error("[Channels/pool] GET failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const { channelId } = await params;
    const body = await req.json();
    const { accountId, priority, weight } = body as {
      accountId?: string;
      priority?: number;
      weight?: number;
    };

    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    // Same type-match + soft-delete + DISABLED checks as channel POST/PATCH
    // (P0 #3 / EC-9.10) — keep the rules consistent so the pool can't admit
    // accounts that the worker would refuse.
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { type: true },
    });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, type: true, status: true, deletedAt: true },
    });
    if (!account || account.deletedAt) {
      return NextResponse.json({ error: `Account ${accountId} not found` }, { status: 400 });
    }
    if (account.type !== channel.type) {
      return NextResponse.json(
        { error: `Account type ${account.type} does not match channel type ${channel.type}` },
        { status: 400 },
      );
    }
    if (account.status === "DISABLED") {
      return NextResponse.json(
        { error: `Account is DISABLED — pick a different account` },
        { status: 400 },
      );
    }

    const entry = await prisma.channelAccountPool.upsert({
      where: { channelId_accountId: { channelId, accountId } },
      create: {
        channelId,
        accountId,
        priority: typeof priority === "number" ? priority : 0,
        weight: typeof weight === "number" ? weight : 1,
      },
      update: {
        // Updating priority/weight via re-POST is intentional — recruiter
        // UI doesn't need a separate PATCH endpoint for these scalars.
        ...(typeof priority === "number" ? { priority } : {}),
        ...(typeof weight === "number" ? { weight } : {}),
      },
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    console.error("[Channels/pool] POST failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  try {
    const { channelId } = await params;
    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId");
    if (!accountId) {
      return NextResponse.json({ error: "accountId query param is required" }, { status: 400 });
    }

    const result = await prisma.channelAccountPool.deleteMany({
      where: { channelId, accountId },
    });
    return NextResponse.json({ removed: result.count });
  } catch (err) {
    console.error("[Channels/pool] DELETE failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

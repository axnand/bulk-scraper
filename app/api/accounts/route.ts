import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAccountStats } from "@/lib/services/account.service";
import { getInMailBalance } from "@/lib/services/unipile.service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = await getAccountStats();

    // Fetch InMail balance for LINKEDIN accounts in parallel (non-blocking on error)
    const balances = await Promise.allSettled(
      accounts.map((a: any) =>
        a.type === "LINKEDIN" && a.dsn && a.apiKey
          ? getInMailBalance({ accountId: a.accountId, accountDsn: a.dsn, accountApiKey: a.apiKey })
          : Promise.resolve(null),
      ),
    );

    const masked = accounts.map((a: any, i: number) => ({
      ...a,
      apiKey: a.apiKey ? `${"•".repeat(Math.max(0, a.apiKey.length - 4))}${a.apiKey.slice(-4)}` : "",
      inmailBalance: balances[i].status === "fulfilled" ? balances[i].value : null,
    }));

    return NextResponse.json({ accounts: masked });
  } catch (error) {
    console.error("Error fetching account stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, accountId, dsn, apiKey, type } = body;

    if (!accountId || !dsn || !apiKey) {
      return NextResponse.json(
        { error: "accountId, dsn, and apiKey are required." },
        { status: 400 }
      );
    }

    const validTypes = ["LINKEDIN", "EMAIL", "WHATSAPP"];
    if (type && !validTypes.includes(type)) {
      return NextResponse.json({ error: "type must be LINKEDIN | EMAIL | WHATSAPP" }, { status: 400 });
    }

    // Check for duplicate accountId
    const existing = await prisma.account.findUnique({
      where: { accountId },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Account with ID "${accountId}" already exists.` },
        { status: 409 }
      );
    }

    const account = await prisma.account.create({
      data: {
        accountId,
        name: name || "",
        type: type || "LINKEDIN",
        dsn,
        apiKey,
        status: "ACTIVE",
      },
    });

    return NextResponse.json({
      message: "Account created successfully",
      account: {
        id: account.id,
        accountId: account.accountId,
        name: account.name,
        dsn: account.dsn,
        status: account.status,
      },
    });
  } catch (error) {
    console.error("Error creating account:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

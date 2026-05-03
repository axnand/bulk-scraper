import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function getUnipile() {
  // 1. Try global env vars
  const rawDsn = process.env.UNIPILE_DSN;
  const apiKey = process.env.UNIPILE_API_KEY;

  if (rawDsn && apiKey) {
    const dsn = rawDsn.startsWith("http") ? rawDsn : `https://${rawDsn}`;
    return { dsn, apiKey };
  }

  // 2. Fall back to first active account in DB that has dsn + apiKey set
  const account = await prisma.account.findFirst({
    where: {
      status: { not: "DISABLED" },
      deletedAt: null,
      dsn: { not: null },
      apiKey: { not: null },
    },
    orderBy: { lastUsedAt: "desc" },
  });

  if (account?.dsn && account?.apiKey) {
    const dsn = account.dsn.startsWith("http") ? account.dsn : `https://${account.dsn}`;
    return { dsn, apiKey: account.apiKey };
  }

  throw new Error("No Unipile credentials found. Set UNIPILE_DSN + UNIPILE_API_KEY env vars or configure them on an account.");
}

async function unipileRequest(method: string, path: string, body?: object) {
  const { dsn, apiKey } = await getUnipile();
  const res = await fetch(`${dsn}${path}`, {
    method,
    headers: {
      "X-API-KEY": apiKey,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Unipile ${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

/** GET — list all existing webhooks from Unipile */
export async function GET() {
  try {
    const data = await unipileRequest("GET", "/api/v1/webhooks");
    // Unipile returns { object: "WebhookList", items: [...] } or similar
    const items: any[] = data?.items ?? data?.webhooks ?? (Array.isArray(data) ? data : []);
    return NextResponse.json({ webhooks: items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** POST — register messaging + users_relations webhooks for given account IDs */
export async function POST(req: NextRequest) {
  try {
    const { accountIds, appUrl } = (await req.json()) as {
      accountIds: string[];
      appUrl: string;
    };

    if (!appUrl) {
      return NextResponse.json({ error: "appUrl is required" }, { status: 400 });
    }

    const requestUrl = `${appUrl.replace(/\/$/, "")}/api/webhooks/unipile`;
    const accountIdsField = accountIds.length > 0 ? { account_ids: accountIds } : {};

    const [messaging, relations] = await Promise.all([
      unipileRequest("POST", "/api/v1/webhooks", {
        source: "messaging",
        request_url: requestUrl,
        name: "outreach-messaging",
        format: "json",
        enabled: true,
        events: ["message_received"],
        ...accountIdsField,
      }),
      unipileRequest("POST", "/api/v1/webhooks", {
        source: "users",
        request_url: requestUrl,
        name: "outreach-relations",
        format: "json",
        enabled: true,
        events: ["new_relation"],
        ...accountIdsField,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      created: [messaging, relations],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** DELETE — remove a webhook by ID */
export async function DELETE(req: NextRequest) {
  try {
    const { webhookId } = (await req.json()) as { webhookId: string };
    if (!webhookId) return NextResponse.json({ error: "webhookId required" }, { status: 400 });
    await unipileRequest("DELETE", `/api/v1/webhooks/${webhookId}`);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

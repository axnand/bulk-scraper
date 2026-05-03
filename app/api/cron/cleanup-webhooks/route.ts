import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const { count } = await prisma.webhookEvent.deleteMany({
    where: { receivedAt: { lt: cutoff } },
  });

  console.log(`[CleanupWebhooks] Deleted ${count} WebhookEvent rows older than ${RETENTION_DAYS} days (cutoff=${cutoff.toISOString()})`);

  return NextResponse.json({ deleted: count, cutoff: cutoff.toISOString(), retentionDays: RETENTION_DAYS });
}

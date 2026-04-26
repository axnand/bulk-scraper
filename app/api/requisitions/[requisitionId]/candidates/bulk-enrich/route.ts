import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  findWorkEmail, findPersonalEmail, findPhone,
  AirscaleError, type EnrichType,
} from "@/lib/airscale";

export const dynamic = "force-dynamic";

const CONCURRENCY = 3;

async function enrichOne(
  taskId: string,
  url: string,
  existingContact: any,
  type: EnrichType,
): Promise<{ taskId: string; ok: boolean; error?: string }> {
  const [workEmail, personalEmail, phone] = await Promise.all([
    type === "work_email"     || type === "all" ? findWorkEmail(url)     : Promise.resolve(null),
    type === "personal_email" || type === "all" ? findPersonalEmail(url) : Promise.resolve(null),
    type === "phone"          || type === "all" ? findPhone(url)         : Promise.resolve(null),
  ]);

  const hasData = workEmail || personalEmail || phone;
  if (!hasData) return { taskId, ok: false, error: "No data found" };

  await prisma.candidateContact.upsert({
    where: { taskId },
    create: {
      taskId,
      workEmail:     workEmail ?? existingContact?.workEmail ?? null,
      personalEmail: personalEmail ?? existingContact?.personalEmail ?? null,
      phone:         phone ?? existingContact?.phone ?? null,
      email:         existingContact?.email ?? null,
      linkedinEmail: existingContact?.linkedinEmail ?? null,
      salary:        existingContact?.salary ?? null,
      source:        "AIRSCALE",
      enrichedAt:    new Date(),
    },
    update: {
      ...(workEmail     !== null ? { workEmail }     : {}),
      ...(personalEmail !== null ? { personalEmail } : {}),
      ...(phone         !== null ? { phone }         : {}),
      source:     "AIRSCALE",
      enrichedAt: new Date(),
    },
  });

  return { taskId, ok: true };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> },
) {
  const { requisitionId } = await params;
  const body = await req.json().catch(() => ({}));
  const { taskIds } = body as { taskIds?: string[] };
  const type: EnrichType = ["work_email", "personal_email", "phone", "all"].includes(body.type)
    ? body.type
    : "all";

  if (!taskIds?.length) {
    return NextResponse.json({ error: "taskIds array is required" }, { status: 400 });
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, job: { requisitionId } },
    select: { id: true, url: true, contact: true },
  });

  if (tasks.length === 0) {
    return NextResponse.json({ error: "No valid tasks found" }, { status: 404 });
  }

  const results: { taskId: string; ok: boolean; error?: string }[] = [];

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const chunk = tasks.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(t => enrichOne(t.id, t.url, t.contact, type)),
    );

    for (const r of settled) {
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        const err = r.reason;
        if (err instanceof AirscaleError && err.statusCode === 402) {
          return NextResponse.json({
            error: "Airscale credit limit reached",
            enriched: results.filter(r => r.ok).length,
            failed: results.filter(r => !r.ok).length,
            results,
          }, { status: 402 });
        }
        results.push({ taskId: "unknown", ok: false, error: err?.message ?? "Unknown error" });
      }
    }
  }

  const enriched = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  return NextResponse.json({ enriched, failed, total: tasks.length, results });
}

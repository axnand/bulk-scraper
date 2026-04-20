import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAndValidateUrls } from "@/lib/validators";
import { triggerProcessing } from "@/lib/trigger";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);
    const runs = await prisma.job.findMany({
      where: { requisitionId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("[Runs] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);
    const body = await req.json();
    const rawUrls: string = body?.urls || "";

    const { valid, invalid } = parseAndValidateUrls(rawUrls);
    if (valid.length === 0) {
      return NextResponse.json(
        { error: "No valid LinkedIn URLs found.", invalidUrls: invalid },
        { status: 400 }
      );
    }

    const requisition = await prisma.requisition.findUnique({ where: { id: requisitionId } });
    if (!requisition) {
      return NextResponse.json({ error: "Requisition not found" }, { status: 404 });
    }

    // Snapshot the requisition config onto the run so later edits don't rewrite history.
    const runConfig = requisition.config || "{}";

    const run = await prisma.job.create({
      data: {
        requisitionId,
        title: requisition.title,
        department: requisition.department,
        totalTasks: valid.length,
        status: "PENDING",
        config: runConfig,
      },
    });

    const BATCH_SIZE = 100;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      await prisma.task.createMany({
        data: batch.map(url => ({ jobId: run.id, url, status: "PENDING" })),
      });
    }

    // bump the requisition's updatedAt so it sorts to top of the list
    await prisma.requisition.update({
      where: { id: requisitionId },
      data: { updatedAt: new Date() },
    });

    after(async () => { await triggerProcessing(); });

    return NextResponse.json({
      runId: run.id,
      totalTasks: valid.length,
      invalidUrls: invalid.length > 0 ? invalid : undefined,
    });
  } catch (error) {
    console.error("[Runs] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

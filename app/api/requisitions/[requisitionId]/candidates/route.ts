import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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
      select: { id: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
    });

    const runMeta: Record<string, { createdAt: Date; status: string; index: number }> = {};
    runs.forEach((r, idx) => {
      runMeta[r.id] = { createdAt: r.createdAt, status: r.status, index: runs.length - idx };
    });

    if (runs.length === 0) {
      return NextResponse.json({ runs: [], tasks: [] });
    }

    const tasks = await prisma.task.findMany({
      where: { jobId: { in: runs.map(r => r.id) } },
      orderBy: { createdAt: "desc" },
    });

    const shaped = tasks.map(t => ({
      id: t.id,
      runId: t.jobId,
      runIndex: runMeta[t.jobId]?.index ?? 0,
      addedAt: t.createdAt,
      url: t.url,
      status: t.status,
      result: t.result ? JSON.parse(t.result) : null,
      analysisResult: t.analysisResult ? JSON.parse(t.analysisResult) : null,
      errorMessage: t.errorMessage,
      retryCount: t.retryCount,
    }));

    return NextResponse.json({
      runs: runs.map((r, idx) => ({ ...r, index: runs.length - idx })),
      tasks: shaped,
    });
  } catch (error) {
    console.error("[Candidates] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

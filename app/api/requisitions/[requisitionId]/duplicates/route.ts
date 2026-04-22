import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

const TASK_SELECT = {
  id: true,
  url: true,
  sourceFileName: true,
  status: true,
  createdAt: true,
  jobId: true,
  analysisResult: true,
} as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);

    const pairs = await prisma.duplicatePair.findMany({
      where: { requisitionId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        taskA: { select: TASK_SELECT },
        taskB: { select: TASK_SELECT },
      },
    });

    return NextResponse.json({ pairs });
  } catch (error) {
    console.error("[Duplicates] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

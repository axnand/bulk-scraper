import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Action = "DELETE_A" | "DELETE_B" | "KEEP_BOTH";

const STATUS_MAP: Record<Action, string> = {
  DELETE_A: "RESOLVED_DELETED_A",
  DELETE_B: "RESOLVED_DELETED_B",
  KEEP_BOTH: "RESOLVED_KEPT_BOTH",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pairId: string }> }
) {
  try {
    const { pairId } = await params;
    const body = await req.json();
    const action: Action = body.action;
    const resolvedBy: string | null = body.resolvedBy ?? null;

    if (!Object.keys(STATUS_MAP).includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const pair = await prisma.duplicatePair.findUnique({
      where: { id: pairId },
      include: {
        taskA: { include: { job: true } },
        taskB: { include: { job: true } },
      },
    });

    if (!pair) {
      return NextResponse.json({ error: "Pair not found" }, { status: 404 });
    }
    if (pair.status !== "PENDING") {
      return NextResponse.json({ error: "Pair already resolved" }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      if (action === "KEEP_BOTH") {
        await tx.duplicatePair.update({
          where: { id: pairId },
          data: { status: "RESOLVED_KEPT_BOTH", resolvedAt: new Date(), resolvedBy },
        });
        return;
      }

      const taskToDelete = action === "DELETE_A" ? pair.taskA : pair.taskB;
      const job = taskToDelete.job;

      // Deleting the task cascade-deletes all DuplicatePair rows referencing it (including pairId).
      await tx.task.delete({ where: { id: taskToDelete.id } });

      // Recalculate job counters from remaining tasks
      const remaining = await tx.task.findMany({
        where: { jobId: job.id },
        select: { status: true },
      });
      const total = remaining.length;
      const successCount = remaining.filter((t) => t.status === "DONE").length;
      const failedCount = remaining.filter((t) => t.status === "FAILED").length;
      const hasActive = remaining.some((t) => t.status === "PENDING" || t.status === "PROCESSING");

      await tx.job.update({
        where: { id: job.id },
        data: {
          totalTasks: total,
          successCount,
          failedCount,
          processedCount: successCount + failedCount,
          status: total === 0 || (!hasActive) ? "COMPLETED" : job.status,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Duplicates] resolve failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

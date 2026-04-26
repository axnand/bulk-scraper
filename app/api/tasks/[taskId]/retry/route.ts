import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enqueueTaskBatch } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { job: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "FAILED") {
      return NextResponse.json({ error: "Only failed tasks can be retried" }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: {
          status: "PENDING",
          errorMessage: null,
          retryCount: task.retryCount + 1,
        },
      }),
      prisma.job.update({
        where: { id: task.job.id },
        data: {
          processedCount: Math.max(0, task.job.processedCount - 1),
          failedCount: Math.max(0, task.job.failedCount - 1),
        },
      }),
    ]);

    await enqueueTaskBatch([{ id: task.id, source: task.source }]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Task Retry] POST failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

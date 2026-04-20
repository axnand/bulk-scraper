import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        job: {
          include: { requisition: true },
        },
        stageEvents: {
          orderBy: { createdAt: "asc" },
        },
        outreachMessages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            channel: true,
            status: true,
            direction: true,
            renderedBody: true,
            inboundBody: true,
            sentAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: task.id,
      url: task.url,
      source: task.source,
      sourceFileName: task.sourceFileName,
      hasResume: !!task.sourceFileUrl,
      status: task.status,
      stage: task.stage,
      createdAt: task.createdAt,
      result: task.result ? JSON.parse(task.result) : null,
      analysisResult: task.analysisResult ? JSON.parse(task.analysisResult) : null,
      errorMessage: task.errorMessage,
      job: {
        id: task.job.id,
        title: task.job.title,
        requisitionId: task.job.requisitionId,
        requisitionTitle: task.job.requisition?.title ?? task.job.title,
        config: task.job.config ? JSON.parse(task.job.config) : null,
      },
      stageEvents: task.stageEvents,
      outreachMessages: task.outreachMessages,
    });
  } catch (error) {
    console.error("[Task] GET failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Fetch job with all tasks including results
    const job = await prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const tasks = await prisma.task.findMany({
      where: { jobId },
      orderBy: { createdAt: "asc" },
    });

    // Parse result JSON strings into objects
    const parsedTasks = tasks.map((task: any) => ({
      id: task.id,
      url: task.url,
      status: task.status,
      // P1 #37 — expose explicit analysis sub-state so the UI can render a
      // "needs review" filter (analysisStatus === 'FAILED') without inferring
      // from null analysisResult + non-null errorMessage.
      analysisStatus: task.analysisStatus,
      result: task.result ? JSON.parse(task.result) : null,
      analysisResult: task.analysisResult ? JSON.parse(task.analysisResult) : null,
      errorMessage: task.errorMessage || null,
      retryCount: task.retryCount,
      accountId: task.accountId || null,
      createdAt: task.createdAt,
    }));

    const config = job.config ? JSON.parse(job.config) : {};

    return NextResponse.json({
      id: job.id,
      title: (job as any).title || "Untitled Requisition",
      department: (job as any).department || "",
      status: job.status,
      totalTasks: job.totalTasks,
      processedCount: job.processedCount,
      successCount: (job as any).successCount ?? 0,
      failedCount: (job as any).failedCount ?? 0,
      createdAt: job.createdAt,
      config,
      tasks: parsedTasks,
    });
  } catch (error) {
    console.error("Error fetching job results:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

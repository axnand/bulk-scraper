import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { triggerProcessing } from "@/lib/trigger";

type Action = "pause" | "resume" | "cancel";

const TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = await req.json().catch(() => ({}));
    const action: Action = body.action || "cancel";

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (action === "pause") {
      if (job.status !== "PROCESSING" && job.status !== "PENDING") {
        return NextResponse.json(
          { error: `Cannot pause a job that is ${job.status.toLowerCase()}` },
          { status: 400 }
        );
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: "PAUSED" },
      });

      return NextResponse.json({
        message: "Job paused successfully",
        jobId,
        status: "PAUSED",
      });
    }

    if (action === "resume") {
      if (job.status !== "PAUSED") {
        return NextResponse.json(
          { error: `Cannot resume a job that is ${job.status.toLowerCase()}` },
          { status: 400 }
        );
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: "PROCESSING" },
      });

      // Re-trigger the processing chain
      triggerProcessing().catch((err) =>
        console.error("[Resume] Failed to trigger processing:", err)
      );

      return NextResponse.json({
        message: "Job resumed successfully",
        jobId,
        status: "PROCESSING",
      });
    }

    // Default: cancel
    if (TERMINAL_STATUSES.includes(job.status)) {
      return NextResponse.json(
        { error: `Job is already ${job.status.toLowerCase()}` },
        { status: 400 }
      );
    }

    // Mark all pending/processing tasks as FAILED immediately so they don't
    // get stuck in PENDING forever (the processor skips CANCELLED jobs).
    const cancelled = await prisma.task.updateMany({
      where: { jobId, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "FAILED", errorMessage: "Job was cancelled" },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: "CANCELLED",
        failedCount: { increment: cancelled.count },
        processedCount: { increment: cancelled.count },
      },
    });

    console.log(`[Cancel] Job ${jobId.slice(-6)} cancelled — ${cancelled.count} pending tasks marked FAILED`);

    return NextResponse.json({
      message: "Job cancelled successfully",
      jobId,
      status: "CANCELLED",
    });
  } catch (error) {
    console.error("Error updating job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

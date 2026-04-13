import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const { jobId } = await params;

        // Fetch Job and its Tasks
        const [job, lastDoneTask] = await Promise.all([
            prisma.job.findUnique({
                where: { id: jobId },
                include: {
                    tasks: {
                        select: { status: true },
                    },
                },
            }),
            prisma.task.findFirst({
                where: { jobId, status: "DONE" },
                orderBy: { updatedAt: "desc" },
                select: { analysisResult: true },
            }),
        ]);

        if (!job) {
            return NextResponse.json({ error: "Job not found" }, { status: 404 });
        }

        // Calculate aggregated task overview
        const tasksOverview = {
            pending: 0,
            processing: 0,
            done: 0,
            failed: 0,
        };

        job.tasks.forEach((task: { status: string }) => {
            const status = task.status.toLowerCase() as keyof typeof tasksOverview;
            if (tasksOverview[status] !== undefined) {
                tasksOverview[status]++;
            }
        });

        // Extract the name of the most recently processed candidate
        let lastProcessedName: string | null = null;
        if (lastDoneTask?.analysisResult) {
            try {
                const ar = JSON.parse(lastDoneTask.analysisResult);
                lastProcessedName = ar.candidateInfo?.name || null;
            } catch { /* ignore parse errors */ }
        }

        return NextResponse.json({
            id: job.id,
            status: job.status,
            totalTasks: job.totalTasks,
            processedCount: job.processedCount,
            successCount: (job as any).successCount ?? 0,
            failedCount: (job as any).failedCount ?? 0,
            createdAt: job.createdAt,
            tasks: tasksOverview,
            lastProcessedName,
        });
    } catch (error) {
        console.error("Error fetching job status:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAndValidateUrls } from "@/lib/validators";
import { triggerProcessing } from "@/lib/trigger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({
      jobs: jobs.map((job: any) => ({
        id: job.id,
        status: job.status,
        totalTasks: job.totalTasks,
        processedCount: job.processedCount,
        successCount: job.successCount ?? 0,
        failedCount: job.failedCount ?? 0,
        createdAt: job.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error listing jobs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();

        if (!body || !body.urls || typeof body.urls !== "string") {
            return NextResponse.json(
                { error: "Invalid request payload. Expected 'urls' string." },
                { status: 400 }
            );
        }

        const { valid, invalid } = parseAndValidateUrls(body.urls);

        if (valid.length === 0) {
            return NextResponse.json(
                { error: "No valid LinkedIn URLs found.", invalidUrls: invalid },
                { status: 400 }
            );
        }

        // 1. Build config object (if analysis fields provided)
        let config: string | undefined;
        if (body.jobDescription || body.customPrompt || body.scoringRules || body.customScoringRules) {
            config = JSON.stringify({
                jobDescription: body.jobDescription || "",
                customPrompt: body.customPrompt || "",
                scoringRules: body.scoringRules || {},
                customScoringRules: body.customScoringRules || [],
                sheetWebAppUrl: body.sheetWebAppUrl || "",
                jdTitle: body.jdTitle || "Bulk Analysis",
                aiModel: body.aiModel || "gpt-4.1",
                minScoreThreshold: body.minScoreThreshold ?? 0,
            });
        }

        // 2. Create Job and Tasks in a transaction
        const job = await prisma.$transaction(async (tx: any) => {
            // Create the Job entry
            const newJob = await tx.job.create({
                data: {
                    totalTasks: valid.length,
                    status: "PENDING",
                    config: config || null,
                },
            });

            // Create Task entries using createMany to be efficient
            await tx.task.createMany({
                data: valid.map((url) => ({
                    jobId: newJob.id,
                    url,
                    status: "PENDING",
                })),
            });

            return newJob;
        });

        // 3. Kick off processing immediately via after()
        after(async () => {
            await triggerProcessing();
        });

        return NextResponse.json({
            message: "Job created successfully",
            jobId: job.id,
            totalTasks: valid.length,
            invalidUrls: invalid.length > 0 ? invalid : undefined,
        });
    } catch (error) {
        console.error("Error creating job:", error);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

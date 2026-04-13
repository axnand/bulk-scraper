import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAndValidateUrls } from "@/lib/validators";
import { triggerProcessing } from "@/lib/trigger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.job.count(),
    ]);

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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
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

        // 1. Resolve evaluation config source
        let promptRole: string | undefined;
        let promptGuidelines: string | undefined;
        let criticalInstructions: string | undefined;
        let resolvedScoringRules = body.scoringRules || {};
        let resolvedCustomScoringRules = body.customScoringRules || [];
        let resolvedBuiltInRuleDescriptions = body.builtInRuleDescriptions || {};

        if (body.evaluationConfigId) {
            // New path: resolve PROMPT config from EvaluationConfig (scoring comes from body/JD)
            try {
                const evalConfig = await prisma.evaluationConfig.findUnique({
                    where: { id: body.evaluationConfigId },
                });
                if (evalConfig) {
                    if (evalConfig.promptRole?.trim()) promptRole = evalConfig.promptRole;
                    if (evalConfig.promptGuidelines?.trim()) promptGuidelines = evalConfig.promptGuidelines;
                    if (evalConfig.criticalInstructions?.trim()) criticalInstructions = evalConfig.criticalInstructions;
                    console.log(`[Jobs] Using EvaluationConfig "${evalConfig.title}" (${evalConfig.id}) for prompt config`);
                }
            } catch (e) {
                console.warn("[Jobs] Failed to load EvaluationConfig, falling back:", e);
            }
        }

        // Fallback: read from AppSettings (backward compat for extension)
        if (!body.evaluationConfigId) {
            try {
                const appSettings = await prisma.appSettings.findUnique({ where: { id: "global" } });
                if (appSettings?.promptRole?.trim()) promptRole = appSettings.promptRole;
                if (appSettings?.promptGuidelines?.trim()) promptGuidelines = appSettings.promptGuidelines;
                if (appSettings?.criticalInstructions?.trim()) criticalInstructions = appSettings.criticalInstructions;
                if (promptRole || promptGuidelines || criticalInstructions) {
                    console.log(`[Jobs] Snapshotting AI eval settings — role: ${promptRole ? 'custom' : 'default'}, guidelines: ${promptGuidelines ? 'custom' : 'default'}, criticalInstructions: ${criticalInstructions ? 'custom' : 'default'}`);
                }
            } catch {
                // Non-fatal — fall back to built-in defaults
            }
        }

        // 2. Build config object (if analysis fields provided)
        let config: string | undefined;
        if (body.jobDescription || body.customPrompt || body.scoringRules || body.customScoringRules || body.evaluationConfigId || promptRole || promptGuidelines || criticalInstructions || body.builtInRuleDescriptions) {
            config = JSON.stringify({
                jobDescription: body.jobDescription || "",
                customPrompt: body.customPrompt || "",
                scoringRules: resolvedScoringRules,
                customScoringRules: resolvedCustomScoringRules,
                sheetWebAppUrl: body.sheetWebAppUrl || "",
                jdTitle: body.jdTitle || "Bulk Analysis",
                aiModel: body.aiModel,
                aiProviderId: body.aiProviderId || undefined,
                minScoreThreshold: body.minScoreThreshold ?? 0,
                ...(promptRole && { promptRole }),
                ...(promptGuidelines && { promptGuidelines }),
                ...(criticalInstructions && { criticalInstructions }),
                ...(Object.keys(resolvedBuiltInRuleDescriptions).length > 0 && { builtInRuleDescriptions: resolvedBuiltInRuleDescriptions }),
            });
        }

        // 2. Create the Job first
        const job = await prisma.job.create({
            data: {
                totalTasks: valid.length,
                status: "PENDING",
                config: config || null,
            },
        });

        // 3. Batch-insert tasks in chunks to avoid DB timeouts
        const BATCH_SIZE = 100;
        for (let i = 0; i < valid.length; i += BATCH_SIZE) {
            const batch = valid.slice(i, i + BATCH_SIZE);
            await prisma.task.createMany({
                data: batch.map((url) => ({
                    jobId: job.id,
                    url,
                    status: "PENDING",
                })),
            });
        }

        // 4. Kick off processing immediately via after()
        console.log(`[Jobs] Job ${job.id} created, scheduling after() trigger...`);
        after(async () => {
            console.log(`[Jobs] after() callback fired for job ${job.id}`);
            await triggerProcessing();
            console.log(`[Jobs] after() callback completed for job ${job.id}`);
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

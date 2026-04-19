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
        requisitionId: job.requisitionId ?? null,
        title: job.title || "Untitled Requisition",
        department: job.department || "",
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

        const rawUrls: string = body?.urls || "";
        const jobTitle: string = body?.title || body?.jdTitle || "Untitled Requisition";
        const jobDepartment: string = body?.department || "";

        const { valid, invalid } = rawUrls.trim()
            ? parseAndValidateUrls(rawUrls)
            : { valid: [] as string[], invalid: [] as string[] };

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

        // If a JD template ID is provided, pull scoring config directly from DB — it is the source of truth.
        // This ensures edits saved via the UI are always reflected, even if the client state was stale.
        if (body.jdTemplateId) {
            try {
                const jdTemplate = await prisma.jdTemplate.findUnique({
                    where: { id: body.jdTemplateId },
                });
                if (jdTemplate) {
                    try { resolvedScoringRules = JSON.parse(jdTemplate.scoringRules) || {}; } catch { /* keep body fallback */ }
                    try { resolvedCustomScoringRules = JSON.parse(jdTemplate.customScoringRules) || []; } catch { /* keep body fallback */ }
                    try { resolvedBuiltInRuleDescriptions = JSON.parse(jdTemplate.builtInRuleDescriptions || "{}") || {}; } catch { /* keep body fallback */ }
                    console.log(`[Jobs] Resolved scoring config from JD template "${jdTemplate.title}" (${jdTemplate.id})`);
                }
            } catch (e) {
                console.warn("[Jobs] Failed to load JD template, falling back to body:", e);
            }
        }

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
                    // Merge eval config rule descriptions as base — body/JD template overrides win per rule
                    if (evalConfig.builtInRuleDescriptions) {
                        try {
                            const evalDescs = JSON.parse(evalConfig.builtInRuleDescriptions) as Record<string, string>;
                            resolvedBuiltInRuleDescriptions = { ...evalDescs, ...resolvedBuiltInRuleDescriptions };
                        } catch { /* ignore invalid JSON */ }
                    }
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

        // 2. Build config object
        const config = JSON.stringify({
            jobDescription: body.jobDescription || "",
            customPrompt: body.customPrompt || "",
            scoringRules: resolvedScoringRules,
            customScoringRules: resolvedCustomScoringRules,
            sheetWebAppUrl: body.sheetWebAppUrl || "",
            jdTitle: jobTitle,
            aiModel: body.aiModel,
            aiProviderId: body.aiProviderId || undefined,
            minScoreThreshold: body.minScoreThreshold ?? 0,
            ...(promptRole && { promptRole }),
            ...(promptGuidelines && { promptGuidelines }),
            ...(criticalInstructions && { criticalInstructions }),
            ...(Object.keys(resolvedBuiltInRuleDescriptions).length > 0 && { builtInRuleDescriptions: resolvedBuiltInRuleDescriptions }),
        });

        // 2. Resolve parent Requisition (create or find by title; keeps the extension contract working)
        let requisitionId: string | null = body?.requisitionId || null;
        if (!requisitionId) {
            const existing = await prisma.requisition.findFirst({
                where: { title: jobTitle, archived: false },
                orderBy: { updatedAt: "desc" },
            });
            if (existing) {
                requisitionId = existing.id;
            } else {
                const created = await prisma.requisition.create({
                    data: { title: jobTitle, department: jobDepartment, config },
                });
                requisitionId = created.id;
            }
        }

        // 3. Create the Job (bulk run) under the requisition
        const job = await prisma.job.create({
            data: {
                requisitionId,
                title: jobTitle,
                department: jobDepartment,
                totalTasks: valid.length,
                status: valid.length > 0 ? "PENDING" : "COMPLETED",
                config,
            },
        });

        // bump requisition updatedAt so it sorts to top
        if (requisitionId) {
            await prisma.requisition.update({
                where: { id: requisitionId },
                data: { updatedAt: new Date() },
            }).catch(() => {});
        }

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

        // 4. Kick off processing only if there are tasks
        if (valid.length > 0) {
            console.log(`[Jobs] Job ${job.id} created, scheduling after() trigger...`);
            after(async () => {
                console.log(`[Jobs] after() callback fired for job ${job.id}`);
                await triggerProcessing();
                console.log(`[Jobs] after() callback completed for job ${job.id}`);
            });
        }

        return NextResponse.json({
            message: "Job created successfully",
            jobId: job.id,
            requisitionId,
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

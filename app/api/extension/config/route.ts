import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** CORS headers — allows the Chrome extension (any origin) to call this endpoint */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400", // cache preflight for 24h
};

/**
 * OPTIONS /api/extension/config
 * Handle CORS preflight request (browser sends this before the actual GET
 * because the Authorization header makes it a "non-simple" request).
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/extension/config
 *
 * Returns the full configuration the Chrome extension needs:
 * JD templates, prompt templates, app settings, and the active AI provider
 * (with unmasked API key).
 *
 * Secured via Bearer token (EXTENSION_SECRET env var).
 */
export async function GET(req: NextRequest) {
  // Auth check
  const secret = process.env.EXTENSION_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: corsHeaders }
      );
    }
  }

  try {
    // Fetch all data in parallel
    const [jdTemplatesRaw, settings, providers, evalConfigsRaw, sheetIntegrations] =
      await Promise.all([
        prisma.jdTemplate.findMany({ orderBy: { updatedAt: "desc" } }),
        prisma.appSettings.findUnique({ where: { id: "global" } }),
        prisma.aiProvider.findMany({ orderBy: { createdAt: "desc" } }),
        prisma.evaluationConfig.findMany({ orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }),
        prisma.sheetIntegration.findMany({ orderBy: { createdAt: "desc" } }),
      ]);

    // Ensure at least one default eval config exists
    let evalConfigs = evalConfigsRaw;
    if (evalConfigs.length === 0 || !evalConfigs.some((c) => c.isDefault)) {
      if (evalConfigs.length === 0) {
        await prisma.evaluationConfig.create({
          data: { title: "System Default", isDefault: true },
        });
      } else {
        await prisma.evaluationConfig.update({
          where: { id: evalConfigs[0].id },
          data: { isDefault: true },
        });
      }
      evalConfigs = await prisma.evaluationConfig.findMany({
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      });
    }

    // Parse JSON fields on JD templates
    const jdTemplates = jdTemplatesRaw.map((t) => ({
      ...t,
      scoringRules: JSON.parse(t.scoringRules),
      customScoringRules: JSON.parse(t.customScoringRules),
      builtInRuleDescriptions: JSON.parse(t.builtInRuleDescriptions || "{}"),
    }));

    // Resolve the active AI provider
    const activeProviderId = settings?.aiProviderId;
    let aiProvider = null;

    if (activeProviderId) {
      aiProvider = providers.find((p) => p.id === activeProviderId) || null;
    }
    if (!aiProvider) {
      aiProvider = providers.find((p) => p.isDefault) || providers[0] || null;
    }

    // Evaluation configs only carry prompt settings (scoring lives in JD templates)
    const evaluationConfigs = evalConfigs.map((c) => ({
      id: c.id,
      title: c.title,
      isDefault: c.isDefault,
      promptRole: c.promptRole,
      criticalInstructions: c.criticalInstructions,
      promptGuidelines: c.promptGuidelines,
    }));

    return NextResponse.json(
      {
        jdTemplates,
        evaluationConfigs,
        sheetIntegrations: sheetIntegrations.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
        })),
        settings: {
          aiModel: settings?.aiModel || "",
          aiProviderId: settings?.aiProviderId || null,
          sheetWebAppUrl: settings?.sheetWebAppUrl || "",
          minScoreThreshold: settings?.minScoreThreshold ?? 0,
          promptRole: settings?.promptRole || null,
          promptGuidelines: settings?.promptGuidelines || null,
          criticalInstructions: settings?.criticalInstructions || null,
        },
        // All configured providers so the extension can let the user pick one
        aiProviders: providers.map((p) => ({
          id: p.id,
          name: p.name,
          provider: p.provider,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          models: JSON.parse(p.models),
          isDefault: p.isDefault,
        })),
        // Convenience: the currently active provider (matches settings.aiProviderId or default)
        aiProvider: aiProvider
          ? {
              id: aiProvider.id,
              name: aiProvider.name,
              apiKey: aiProvider.apiKey,
              baseUrl: aiProvider.baseUrl,
              provider: aiProvider.provider,
              models: JSON.parse(aiProvider.models),
            }
          : null,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[Extension Config] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

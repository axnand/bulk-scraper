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
    const [jdTemplatesRaw, promptTemplates, settings, providers] =
      await Promise.all([
        prisma.jdTemplate.findMany({ orderBy: { updatedAt: "desc" } }),
        prisma.promptTemplate.findMany({ orderBy: { updatedAt: "desc" } }),
        prisma.appSettings.findUnique({ where: { id: "global" } }),
        prisma.aiProvider.findMany({ orderBy: { createdAt: "desc" } }),
      ]);

    // Parse JSON fields on JD templates
    const jdTemplates = jdTemplatesRaw.map((t) => ({
      ...t,
      scoringRules: JSON.parse(t.scoringRules),
      customScoringRules: JSON.parse(t.customScoringRules),
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

    return NextResponse.json(
      {
        jdTemplates,
        promptTemplates,
        settings: {
          aiModel: settings?.aiModel || "gpt-4.1",
          sheetWebAppUrl: settings?.sheetWebAppUrl || "",
          minScoreThreshold: settings?.minScoreThreshold ?? 0,
          systemPrompt: settings?.systemPrompt || null,
        },
        aiProvider: aiProvider
          ? {
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

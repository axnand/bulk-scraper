import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSystemPrompt } from "@/lib/analyzer";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/default-prompt
 *
 * Returns the full assembled system prompt exactly as the LLM would receive it,
 * incorporating the current saved promptRole/promptGuidelines from settings.
 * If no customizations are saved, returns the built-in default.
 */
export async function GET() {
  try {
    // Fetch current settings to include any user customizations in the preview
    let promptRole: string | undefined;
    let promptGuidelines: string | undefined;
    let criticalInstructions: string | undefined;
    try {
      const settings = await prisma.appSettings.findUnique({ where: { id: "global" } });
      if (settings?.promptRole) promptRole = settings.promptRole;
      if (settings?.promptGuidelines) promptGuidelines = settings.promptGuidelines;
      if (settings?.criticalInstructions) criticalInstructions = settings.criticalInstructions;
    } catch { /* non-fatal */ }

    const assembledPrompt = buildSystemPrompt(
      {
        stability: true,
        growth: true,
        graduation: true,
        companyType: true,
        mba: true,
        skillMatch: true,
        location: true,
      },
      [],
      { promptRole, promptGuidelines, criticalInstructions }
    );

    return NextResponse.json({ prompt: assembledPrompt });
  } catch (error) {
    console.error("Error generating prompt preview:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

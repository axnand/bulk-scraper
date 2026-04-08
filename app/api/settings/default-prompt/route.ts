import { NextResponse } from "next/server";
import { buildSystemPrompt } from "@/lib/analyzer";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/default-prompt
 *
 * Returns the full built-in system prompt exactly as the LLM would receive it
 * when no custom system prompt override is set. Useful so users can see the
 * default and use it as a starting point when writing their own.
 */
export async function GET() {
  try {
    // Build with all rules enabled (the "maximum" default prompt)
    const defaultPrompt = buildSystemPrompt(
      {
        stability: true,
        growth: true,
        graduation: true,
        companyType: true,
        mba: true,
        skillMatch: true,
        location: true,
      },
      [] // no custom scoring rules in the preview
    );

    return NextResponse.json({ prompt: defaultPrompt });
  } catch (error) {
    console.error("Error generating default prompt:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

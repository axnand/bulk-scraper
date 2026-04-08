import { NextRequest, NextResponse } from "next/server";
import { chatCompletion } from "@/lib/ai-adapter";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai-providers/test
 *
 * Tests connectivity to an AI provider by sending a trivial prompt.
 * Accepts either a providerId (existing) or raw config (before saving).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { providerId, provider, baseUrl, apiKey, model } = body;

    if (!model) {
      return NextResponse.json({ error: "model is required" }, { status: 400 });
    }

    // If raw config provided (testing before saving), create a temp provider
    if (!providerId && baseUrl && apiKey) {
      const tempId = `temp_${Date.now()}`;
      // Temporarily insert, test, then delete
      const tempProvider = await prisma.aiProvider.create({
        data: {
          id: tempId,
          name: "Connection Test",
          provider: provider || "openai-compatible",
          baseUrl: baseUrl.replace(/\/+$/, ""),
          apiKey,
          models: JSON.stringify([model]),
        },
      });

      try {
        const result = await chatCompletion(
          [{ role: "user", content: "Reply with exactly: OK" }],
          model,
          { temperature: 0, max_tokens: 10 },
          tempId
        );

        return NextResponse.json({
          success: true,
          response: result.content,
          usage: result.usage,
          model: result.model,
          provider: result.provider,
        });
      } finally {
        await prisma.aiProvider.delete({ where: { id: tempId } }).catch(() => {});
      }
    }

    // Test an existing provider
    if (!providerId) {
      return NextResponse.json(
        { error: "Provide either providerId or (baseUrl + apiKey)" },
        { status: 400 }
      );
    }

    const result = await chatCompletion(
      [{ role: "user", content: "Reply with exactly: OK" }],
      model,
      { temperature: 0, max_tokens: 10 },
      providerId
    );

    return NextResponse.json({
      success: true,
      response: result.content,
      usage: result.usage,
      model: result.model,
      provider: result.provider,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Connection test failed" },
      { status: 400 }
    );
  }
}

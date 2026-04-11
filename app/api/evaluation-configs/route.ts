import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Ensure exactly one system default config exists, return all configs sorted with default first. */
async function ensureDefaultAndList() {
  const defaults = await prisma.evaluationConfig.findMany({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  });

  if (defaults.length === 0) {
    // No default — create one
    await prisma.evaluationConfig.create({
      data: {
        title: "System Default",
        isDefault: true,
        promptRole: null,
        criticalInstructions: null,
        promptGuidelines: null,
      },
    });
  } else if (defaults.length > 1) {
    // Duplicates — delete all but the oldest one
    const [, ...extras] = defaults;
    await prisma.evaluationConfig.deleteMany({
      where: { id: { in: extras.map((d) => d.id) } },
    });
  }

  const configs = await prisma.evaluationConfig.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  // Return only prompt-related fields (scoring lives in JD templates)
  return configs.map((c) => ({
    id: c.id,
    title: c.title,
    isDefault: c.isDefault,
    promptRole: c.promptRole,
    criticalInstructions: c.criticalInstructions,
    promptGuidelines: c.promptGuidelines,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

export async function GET() {
  try {
    const configs = await ensureDefaultAndList();
    return NextResponse.json(configs);
  } catch (error) {
    console.error("Error listing evaluation configs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.title?.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    const data = {
      title: body.title.trim(),
      isDefault: false,
      promptRole: body.promptRole ?? null,
      criticalInstructions: body.criticalInstructions ?? null,
      promptGuidelines: body.promptGuidelines ?? null,
    };

    const config = await prisma.evaluationConfig.create({ data });

    return NextResponse.json({
      id: config.id,
      title: config.title,
      isDefault: config.isDefault,
      promptRole: config.promptRole,
      criticalInstructions: config.criticalInstructions,
      promptGuidelines: config.promptGuidelines,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    });
    } catch (error: any) {
    console.error("Error creating evaluation config:", error);
    return NextResponse.json(
      { error: "Internal server error", detail: error?.message || String(error) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templates = await prisma.jdTemplate.findMany({
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(
      templates.map((t: any) => ({
        ...t,
        scoringRules: JSON.parse(t.scoringRules),
        customScoringRules: JSON.parse(t.customScoringRules),
      }))
    );
  } catch (error) {
    console.error("Error listing JD templates:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.title?.trim() || !body.content?.trim()) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
    }

    const template = await prisma.jdTemplate.create({
      data: {
        title: body.title.trim(),
        content: body.content,
        scoringRules: JSON.stringify(body.scoringRules || {}),
        customScoringRules: JSON.stringify(body.customScoringRules || []),
      },
    });

    return NextResponse.json({
      ...template,
      scoringRules: JSON.parse(template.scoringRules),
      customScoringRules: JSON.parse(template.customScoringRules),
    });
  } catch (error) {
    console.error("Error creating JD template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

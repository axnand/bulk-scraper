import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const template = await prisma.jdTemplate.update({
      where: { id },
      data: {
        ...(body.title != null && { title: body.title.trim() }),
        ...(body.content != null && { content: body.content }),
        ...(body.scoringRules != null && { scoringRules: JSON.stringify(body.scoringRules) }),
        ...(body.customScoringRules != null && { customScoringRules: JSON.stringify(body.customScoringRules) }),
        ...(body.builtInRuleDescriptions != null && { builtInRuleDescriptions: JSON.stringify(body.builtInRuleDescriptions) }),
      },
    });

    return NextResponse.json({
      ...template,
      scoringRules: JSON.parse(template.scoringRules),
      customScoringRules: JSON.parse(template.customScoringRules),
      builtInRuleDescriptions: JSON.parse(template.builtInRuleDescriptions || "{}"),
    });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    console.error("Error updating JD template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.jdTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    console.error("Error deleting JD template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

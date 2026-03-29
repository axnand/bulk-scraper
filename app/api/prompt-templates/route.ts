import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    let templates = await prisma.promptTemplate.findMany({
      orderBy: { updatedAt: "desc" },
    });

    // Seed the default prompt template if none marked as default
    if (!templates.some((t: any) => t.isDefault)) {
      const defaultTemplate = await prisma.promptTemplate.create({
        data: {
          title: "Standard Evaluation",
          content:
            "Evaluate the candidate across: Job fit, education tier, graduation year, total experience, average tenure per company, and job switching frequency. Be precise and data-driven. Flag any concerns like frequent job hops, career gaps, or skill mismatches.",
          isDefault: true,
        },
      });
      templates = [defaultTemplate, ...templates];
    }

    return NextResponse.json(templates);
  } catch (error) {
    console.error("Error listing prompt templates:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.title?.trim() || !body.content?.trim()) {
      return NextResponse.json({ error: "Title and content are required" }, { status: 400 });
    }

    const template = await prisma.promptTemplate.create({
      data: {
        title: body.title.trim(),
        content: body.content,
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    console.error("Error creating prompt template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

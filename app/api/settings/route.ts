import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: "global" },
    });

    return NextResponse.json(
      settings || {
        id: "global",
        aiModel: "gpt-4.1",
        aiProviderId: null,
        sheetWebAppUrl: "",
        minScoreThreshold: 0,
        promptRole: null,
        promptGuidelines: null,
      }
    );
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();

    const settings = await prisma.appSettings.upsert({
      where: { id: "global" },
      create: {
        id: "global",
        aiModel: body.aiModel || "gpt-4.1",
        aiProviderId: body.aiProviderId || null,
        sheetWebAppUrl: body.sheetWebAppUrl || "",
        minScoreThreshold: body.minScoreThreshold ?? 0,
        promptRole: body.promptRole ?? null,
        promptGuidelines: body.promptGuidelines ?? null,
      },
      update: {
        ...(body.aiModel != null && { aiModel: body.aiModel }),
        ...(body.aiProviderId !== undefined && { aiProviderId: body.aiProviderId || null }),
        ...(body.sheetWebAppUrl != null && { sheetWebAppUrl: body.sheetWebAppUrl }),
        ...(body.minScoreThreshold != null && { minScoreThreshold: body.minScoreThreshold }),
        ...(body.promptRole !== undefined && { promptRole: body.promptRole || null }),
        ...(body.promptGuidelines !== undefined && { promptGuidelines: body.promptGuidelines || null }),
      },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

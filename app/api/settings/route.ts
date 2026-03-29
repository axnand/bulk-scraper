import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: "global" },
    });

    return NextResponse.json(
      settings || { id: "global", aiModel: "gpt-4.1", sheetWebAppUrl: "", minScoreThreshold: 0 }
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
        sheetWebAppUrl: body.sheetWebAppUrl || "",
        minScoreThreshold: body.minScoreThreshold ?? 0,
      },
      update: {
        ...(body.aiModel != null && { aiModel: body.aiModel }),
        ...(body.sheetWebAppUrl != null && { sheetWebAppUrl: body.sheetWebAppUrl }),
        ...(body.minScoreThreshold != null && { minScoreThreshold: body.minScoreThreshold }),
      },
    });

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  try {
    const sheets = await prisma.sheetIntegration.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(sheets, { headers: corsHeaders });
  } catch (error) {
    console.error("Failed to fetch sheet integrations:", error);
    return NextResponse.json({ error: "Failed to fetch sheet integrations" }, { status: 500, headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url } = body;

    if (!name || !url) {
      return NextResponse.json({ error: "Name and URL are required" }, { status: 400, headers: corsHeaders });
    }

    const sheet = await prisma.sheetIntegration.create({
      data: { name, url },
    });

    return NextResponse.json(sheet, { headers: corsHeaders });
  } catch (error) {
    console.error("Failed to create sheet integration:", error);
    return NextResponse.json({ error: "Failed to create sheet integration" }, { status: 500, headers: corsHeaders });
  }
}

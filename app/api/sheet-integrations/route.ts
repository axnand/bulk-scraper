import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const sheets = await prisma.sheetIntegration.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(sheets);
  } catch (error) {
    console.error("Failed to fetch sheet integrations:", error);
    return NextResponse.json({ error: "Failed to fetch sheet integrations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url } = body;

    if (!name || !url) {
      return NextResponse.json({ error: "Name and URL are required" }, { status: 400 });
    }

    const sheet = await prisma.sheetIntegration.create({
      data: {
        name,
        url,
      },
    });

    return NextResponse.json(sheet);
  } catch (error) {
    console.error("Failed to create sheet integration:", error);
    return NextResponse.json({ error: "Failed to create sheet integration" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    await prisma.sheetIntegration.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete sheet integration:", error);
    return NextResponse.json({ error: "Failed to delete sheet integration" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();
    const { name, url } = body;

    if (!name || !url) {
      return NextResponse.json({ error: "Name and URL are required" }, { status: 400 });
    }

    const updated = await prisma.sheetIntegration.update({
      where: { id },
      data: { name, url },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update sheet integration:", error);
    return NextResponse.json({ error: "Failed to update sheet integration" }, { status: 500 });
  }
}

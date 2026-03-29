import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();

    const template = await prisma.promptTemplate.update({
      where: { id },
      data: {
        ...(body.title != null && { title: body.title.trim() }),
        ...(body.content != null && { content: body.content }),
      },
    });

    return NextResponse.json(template);
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    console.error("Error updating prompt template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Prevent deleting the default template
    const template = await prisma.promptTemplate.findUnique({ where: { id } });
    if (template?.isDefault) {
      return NextResponse.json({ error: "Cannot delete the default template" }, { status: 400 });
    }

    await prisma.promptTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Template not found" }, { status: 404 });
    }
    console.error("Error deleting prompt template:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

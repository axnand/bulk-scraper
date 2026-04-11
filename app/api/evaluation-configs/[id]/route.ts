import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.evaluationConfig.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { error: "Cannot edit the system default config" },
        { status: 400 }
      );
    }

    const body = await req.json();

    const config = await prisma.evaluationConfig.update({
      where: { id },
      data: {
        ...(body.title != null && { title: body.title.trim() }),
        ...(body.promptRole !== undefined && {
          promptRole: body.promptRole || null,
        }),
        ...(body.criticalInstructions !== undefined && {
          criticalInstructions: body.criticalInstructions || null,
        }),
        ...(body.promptGuidelines !== undefined && {
          promptGuidelines: body.promptGuidelines || null,
        }),
      },
    });

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
    if (error?.code === "P2025") {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }
    console.error("Error updating evaluation config:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await prisma.evaluationConfig.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }

    if (existing.isDefault) {
      return NextResponse.json(
        { error: "Cannot delete the system default config" },
        { status: 400 }
      );
    }

    await prisma.evaluationConfig.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json(
        { error: "Config not found" },
        { status: 404 }
      );
    }
    console.error("Error deleting evaluation config:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

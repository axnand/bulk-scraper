import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveRequisitionId } from "@/lib/resolve-requisition";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);

    const requisition = await prisma.requisition.findUnique({
      where: { id: requisitionId },
      include: {
        jobs: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            totalTasks: true,
            processedCount: true,
            successCount: true,
            failedCount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!requisition) {
      return NextResponse.json({ error: "Requisition not found" }, { status: 404 });
    }

    const config = requisition.config ? JSON.parse(requisition.config) : {};

    return NextResponse.json({
      id: requisition.id,
      title: requisition.title,
      department: requisition.department,
      archived: requisition.archived,
      createdAt: requisition.createdAt,
      updatedAt: requisition.updatedAt,
      config,
      runs: requisition.jobs,
    });
  } catch (error) {
    console.error("[Requisitions] GET [id] failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);
    const body = await req.json();

    const existing = await prisma.requisition.findUnique({ where: { id: requisitionId } });
    if (!existing) {
      return NextResponse.json({ error: "Requisition not found" }, { status: 404 });
    }

    const patch: Record<string, any> = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.department === "string") patch.department = body.department;
    if (typeof body.archived === "boolean") patch.archived = body.archived;

    // Config merge — only specified keys overwrite
    const CONFIG_KEYS = [
      "jobDescription", "jdTitle", "scoringRules", "customScoringRules",
      "aiModel", "aiProviderId", "sheetWebAppUrl", "minScoreThreshold",
      "promptRole", "promptGuidelines", "criticalInstructions",
      "builtInRuleDescriptions", "ruleDefinitions", "promptEnvelope",
    ];
    const currentConfig = existing.config ? JSON.parse(existing.config) : {};
    let configChanged = false;
    for (const k of CONFIG_KEYS) {
      if (k in body) {
        currentConfig[k] = body[k];
        configChanged = true;
      }
    }
    if (configChanged) patch.config = JSON.stringify(currentConfig);

    const updated = await prisma.requisition.update({
      where: { id: requisitionId },
      data: patch,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[Requisitions] PUT failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string }> }
) {
  try {
    const { requisitionId: rawId } = await params;
    const requisitionId = await resolveRequisitionId(rawId);
    await prisma.requisition.delete({ where: { id: requisitionId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Requisitions] DELETE failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

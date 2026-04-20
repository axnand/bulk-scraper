import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_STAGES = new Set<string>(Object.values(CandidateStage));

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string; taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await req.json();
    const { stage, reason } = body as { stage: string; reason?: string };

    if (!stage || !VALID_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { stage: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const [updated] = await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: {
          stage: stage as CandidateStage,
          stageUpdatedAt: new Date(),
        },
        select: { id: true, stage: true, stageUpdatedAt: true },
      }),
      prisma.stageEvent.create({
        data: {
          taskId,
          fromStage: existing.stage,
          toStage: stage as CandidateStage,
          actor: "USER",
          reason: reason || null,
        },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[Candidate Stage] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

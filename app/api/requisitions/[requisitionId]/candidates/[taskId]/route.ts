import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";
import { fanOutToChannels } from "@/lib/channels/fan-out";

export const dynamic = "force-dynamic";

// Stages set by the recruiter manually — persisted in manualStage so they
// survive automatic rollup without being overwritten by thread state changes.
const MANUAL_STAGES = new Set<string>(["INTERVIEW", "HIRED", "REJECTED", "ARCHIVED"]);
const VALID_STAGES = new Set<string>(Object.values(CandidateStage));

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ requisitionId: string; taskId: string }> },
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
      select: { stage: true, jobId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const isManual = MANUAL_STAGES.has(stage);

    const [updated] = await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: {
          stage: stage as CandidateStage,
          // Persist recruiter decisions in manualStage so the rollup respects them
          ...(isManual ? { manualStage: stage as CandidateStage } : {}),
          // Clear manualStage if recruiter is moving back to a system-driven stage
          ...(!isManual ? { manualStage: null } : {}),
          stageUpdatedAt: new Date(),
        },
        select: { id: true, stage: true, manualStage: true, stageUpdatedAt: true },
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

    // Fire-and-forget fan-out when a recruiter manually promotes to SHORTLISTED
    if (stage === "SHORTLISTED" && existing.jobId) {
      fanOutToChannels(taskId, existing.jobId).catch(err =>
        console.error("[Stage PATCH] fanOut failed:", err),
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[Candidate Stage] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

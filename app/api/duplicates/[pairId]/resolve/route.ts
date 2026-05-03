import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canonicalizeLinkedinUrl } from "@/lib/canonicalize-url";

export const dynamic = "force-dynamic";

type Action = "DELETE_A" | "DELETE_B" | "KEEP_BOTH";

const STATUS_MAP: Record<Action, string> = {
  DELETE_A: "RESOLVED_DELETED_A",
  DELETE_B: "RESOLVED_DELETED_B",
  KEEP_BOTH: "RESOLVED_KEPT_BOTH",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pairId: string }> }
) {
  try {
    const { pairId } = await params;
    const body = await req.json();
    const action: Action = body.action;
    const resolvedBy: string | null = body.resolvedBy ?? null;

    if (!Object.keys(STATUS_MAP).includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const pair = await prisma.duplicatePair.findUnique({
      where: { id: pairId },
      include: {
        taskA: { include: { job: true } },
        taskB: { include: { job: true } },
      },
    });

    if (!pair) {
      return NextResponse.json({ error: "Pair not found" }, { status: 404 });
    }
    if (pair.status !== "PENDING") {
      return NextResponse.json({ error: "Pair already resolved" }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      if (action === "KEEP_BOTH") {
        // Phase 6 #29 / EC-10.3 — when a recruiter confirms two Tasks are
        // the same candidate kept across requisitions, ensure they share a
        // single CandidateProfile so cross-task reply propagation works.
        // For LINKEDIN_URL pairs we can canonicalize and find/create; for
        // RESUME_HASH pairs we link to whichever profile already exists.
        await linkTasksToSharedCandidateProfile(tx, pair);

        await tx.duplicatePair.update({
          where: { id: pairId },
          data: { status: "RESOLVED_KEPT_BOTH", resolvedAt: new Date(), resolvedBy },
        });
        return;
      }

      const taskToDelete = action === "DELETE_A" ? pair.taskA : pair.taskB;
      const job = taskToDelete.job;
      const now = new Date();

      // Soft-delete the task — preserves all audit history and relations
      await tx.task.update({
        where: { id: taskToDelete.id },
        data: { deletedAt: now, deletedReason: "duplicate_resolved" },
      });

      // Resolve all pending pairs where the deleted task is task A or task B.
      // Previously these were cascade-deleted when the task was hard-deleted.
      await tx.duplicatePair.updateMany({
        where: { status: "PENDING", taskAId: taskToDelete.id },
        data: { status: "RESOLVED_DELETED_A", resolvedAt: now, resolvedBy },
      });
      await tx.duplicatePair.updateMany({
        where: { status: "PENDING", taskBId: taskToDelete.id },
        data: { status: "RESOLVED_DELETED_B", resolvedAt: now, resolvedBy },
      });

      // Recalculate job counters from remaining non-deleted tasks.
      // The soft-delete middleware on tx automatically excludes deletedAt IS NOT NULL.
      const remaining = await tx.task.findMany({
        where: { jobId: job.id },
        select: { status: true },
      });
      const total = remaining.length;
      const successCount = remaining.filter((t) => t.status === "DONE").length;
      const failedCount = remaining.filter((t) => t.status === "FAILED").length;
      const hasActive = remaining.some((t) => t.status === "PENDING" || t.status === "PROCESSING");

      await tx.job.update({
        where: { id: job.id },
        data: {
          totalTasks: total,
          successCount,
          failedCount,
          processedCount: successCount + failedCount,
          status: !hasActive ? "COMPLETED" : job.status,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Duplicates] resolve failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ResolvePair = {
  kind: string;
  taskAId: string;
  taskBId: string;
  taskA: { id: string; url: string; candidateProfileId: string | null };
  taskB: { id: string; url: string; candidateProfileId: string | null };
};

async function linkTasksToSharedCandidateProfile(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  pair: ResolvePair,
): Promise<void> {
  const a = pair.taskA;
  const b = pair.taskB;

  // Already linked to the same profile — nothing to do.
  if (a.candidateProfileId && b.candidateProfileId && a.candidateProfileId === b.candidateProfileId) {
    return;
  }

  // Reuse whichever side already has a profile, then attach the other side.
  let sharedId: string | null = a.candidateProfileId ?? b.candidateProfileId ?? null;

  if (!sharedId && pair.kind === "LINKEDIN_URL") {
    // Look up by canonical URL of either task; fall back to creating a fresh
    // canonical row if neither resolves.
    const canonical =
      canonicalizeLinkedinUrl(a.url) ?? canonicalizeLinkedinUrl(b.url);
    if (canonical) {
      const existing = await tx.candidateProfile.findFirst({
        where: { canonicalLinkedinUrl: canonical },
        orderBy: { scrapedAt: "desc" },
        select: { id: true },
      });
      if (existing) {
        sharedId = existing.id;
      } else {
        const created = await tx.candidateProfile.create({
          data: {
            linkedinUrl: a.url,
            canonicalLinkedinUrl: canonical,
          },
          select: { id: true },
        });
        sharedId = created.id;
      }
    }
  }

  // For RESUME_HASH pairs without a pre-existing profile we cannot synthesize
  // identity here (no canonical URL). Leave as-is — recruiter resolved the
  // duplicate but cross-requisition propagation simply won't fire for these.
  if (!sharedId) return;

  const updates: Promise<unknown>[] = [];
  if (a.candidateProfileId !== sharedId) {
    updates.push(
      tx.task.update({
        where: { id: a.id },
        data: { candidateProfileId: sharedId },
      }),
    );
  }
  if (b.candidateProfileId !== sharedId) {
    updates.push(
      tx.task.update({
        where: { id: b.id },
        data: { candidateProfileId: sharedId },
      }),
    );
  }
  await Promise.all(updates);
}

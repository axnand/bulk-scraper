import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";
import { fanOutToChannels } from "@/lib/channels/fan-out";
import { stageEventExplicit } from "@/lib/channels/stage-event-context";

export const dynamic = "force-dynamic";

// ─── Stage transition policy ──────────────────────────────────────────────────
//
// The recruiter UI can drag a candidate between stages. Only certain
// transitions are legal — system-derived stages (CONTACT_REQUESTED, CONNECTED,
// MESSAGED, REPLIED) are computed from outreach progress and must not be set
// manually. All other transitions are mapped to a side-effect on the task's
// outreach threads:
//
//   none                  : no change to threads (e.g., SOURCED ↔ SOURCED)
//   fanOut                : create ChannelThreads for active channels
//   archiveOpen           : archive every PENDING/ACTIVE thread
//                           (recruiter "stop outreach")
//   pauseActive           : pause every PENDING/ACTIVE thread (INTERVIEW/HIRED:
//                           keep them paused so we don't double-message during
//                           a hire)
//   archiveAll            : archive every non-archived thread (REJECTED/ARCHIVED)
//   resurrectAndFanOut    : un-archive existing siblings + fan out to any new
//                           channels (recruiter un-rejected / un-archived)
//
// MANUAL_WINS in stage-rollup.ts ensures task.stage stays at the recruiter's
// chosen value even if a webhook tries to derive a different one.

const SYSTEM_DERIVED = new Set<CandidateStage>([
  CandidateStage.CONTACT_REQUESTED,
  CandidateStage.CONNECTED,
  CandidateStage.MESSAGED,
  CandidateStage.REPLIED,
]);

const MANUAL_WINS = new Set<CandidateStage>([
  CandidateStage.INTERVIEW,
  CandidateStage.HIRED,
  CandidateStage.REJECTED,
  CandidateStage.ARCHIVED,
]);

const VALID_STAGES = new Set<string>(Object.values(CandidateStage));

type ThreadEffect =
  | "none"
  | "fanOut"
  | "archiveOpen"
  | "pauseActive"
  | "archiveAll"
  | "resurrectAndFanOut";

type Transition =
  | { kind: "allow"; effect: ThreadEffect; setManualStage: CandidateStage | null }
  | { kind: "refuse"; reason: string };

function evaluateTransition(from: CandidateStage, to: CandidateStage): Transition {
  // Same stage → idempotent no-op (still records a StageEvent because the
  // recruiter took an action and we want it audited).
  if (from === to) {
    return {
      kind: "allow",
      effect: "none",
      setManualStage: MANUAL_WINS.has(to) ? to : null,
    };
  }

  // System-derived stages cannot be set manually. They are computed from
  // ChannelThread state (INVITE_PENDING / CONNECTED / MESSAGED / REPLIED).
  if (SYSTEM_DERIVED.has(to)) {
    if (to === CandidateStage.REPLIED) {
      return {
        kind: "refuse",
        reason: 'REPLIED can only be set by an inbound message. Use the "Log manual reply" action instead.',
      };
    }
    return {
      kind: "refuse",
      reason: `${to} is computed from outreach progress and cannot be set manually. Use the "Log manual outreach" action to record an out-of-band send.`,
    };
  }

  // Targets we get past this point: SOURCED, SHORTLISTED, INTERVIEW, HIRED,
  // REJECTED, ARCHIVED.

  let effect: ThreadEffect = "none";

  if (to === CandidateStage.INTERVIEW || to === CandidateStage.HIRED) {
    // Pause active outreach — we're moving to a hiring stage but want to keep
    // history.
    effect = "pauseActive";
  } else if (to === CandidateStage.REJECTED || to === CandidateStage.ARCHIVED) {
    // Hard stop on outreach.
    effect = "archiveAll";
  } else if (to === CandidateStage.SOURCED) {
    // Recruiter unshortlisted / un-rejected: stop in-flight outreach but
    // don't archive history; threads can be resurrected later.
    if (
      from === CandidateStage.SHORTLISTED ||
      SYSTEM_DERIVED.has(from)
    ) {
      effect = "archiveOpen";
    }
  } else if (to === CandidateStage.SHORTLISTED) {
    if (from === CandidateStage.SOURCED) {
      // Standard promote — fan out to active channels.
      effect = "fanOut";
    } else if (
      from === CandidateStage.ARCHIVED ||
      from === CandidateStage.REJECTED ||
      from === CandidateStage.HIRED ||
      from === CandidateStage.INTERVIEW
    ) {
      // Resurrect previously-closed threads + fan out to any newly-added
      // channels.
      effect = "resurrectAndFanOut";
    }
  }

  return {
    kind: "allow",
    effect,
    setManualStage: MANUAL_WINS.has(to) ? to : null,
  };
}

// ─── PATCH handler ────────────────────────────────────────────────────────────

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
    const toStage = stage as CandidateStage;

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { stage: true, jobId: true, stageUpdatedAt: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Phase 4 #18 / EC-11.10 — optimistic concurrency via the existing
    // Task.stageUpdatedAt column. The client sends `If-Match: <iso>` from
    // its last-known stage timestamp; if the value has changed since (another
    // recruiter dragged the same candidate, or a webhook advanced its stage),
    // reject with 409 and return the current stageUpdatedAt so the UI can
    // reload before retrying.
    const ifMatch = req.headers.get("if-match");
    if (ifMatch) {
      // Strip surrounding quotes that some clients add to ETag/If-Match values
      const clean = ifMatch.replace(/^"+|"+$/g, "");
      const currentIso = existing.stageUpdatedAt.toISOString();
      if (clean !== currentIso) {
        return NextResponse.json(
          {
            error: "stage_concurrency_conflict",
            currentStage: existing.stage,
            currentStageUpdatedAt: currentIso,
          },
          {
            status: 409,
            headers: { ETag: `"${currentIso}"` },
          },
        );
      }
    }

    const transition = evaluateTransition(existing.stage, toStage);
    if (transition.kind === "refuse") {
      return NextResponse.json(
        { error: "stage_transition_refused", reason: transition.reason },
        { status: 422 },
      );
    }

    // Resolve manualStage write: explicit value when this is a MANUAL_WINS
    // target, null when moving back to a system-driven stage.
    const manualStageWrite =
      transition.setManualStage !== null
        ? { manualStage: transition.setManualStage }
        : { manualStage: null };

    const now = new Date();

    // Single transaction for the stage write + audit + thread side-effects.
    // markStageEventExplicit (via stageEventExplicit() raw call) suppresses
    // the task_stage_audit trigger so we don't get a duplicate StageEvent.
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.stage_event_explicit', 'true', true)`;

      const t = await tx.task.update({
        where: { id: taskId },
        data: {
          stage: toStage,
          ...manualStageWrite,
          stageUpdatedAt: now,
        },
        select: { id: true, stage: true, manualStage: true, stageUpdatedAt: true, jobId: true },
      });

      await tx.stageEvent.create({
        data: {
          taskId,
          fromStage: existing.stage,
          toStage,
          actor: "USER",
          reason: reason || null,
        },
      });

      // Apply thread side-effects inside the same transaction so a failure
      // rolls back the stage write too.
      switch (transition.effect) {
        case "none":
          break;
        case "archiveOpen":
          await tx.channelThread.updateMany({
            where: { taskId, status: { in: ["PENDING", "ACTIVE"] } },
            data: {
              status: "ARCHIVED",
              archivedAt: now,
              archivedReason: `Recruiter unshortlisted to ${toStage}`,
              nextActionAt: null,
            },
          });
          break;
        case "pauseActive":
          await tx.channelThread.updateMany({
            where: { taskId, status: { in: ["PENDING", "ACTIVE"] } },
            data: { status: "PAUSED", nextActionAt: null },
          });
          break;
        case "archiveAll":
          await tx.channelThread.updateMany({
            where: { taskId, status: { not: "ARCHIVED" } },
            data: {
              status: "ARCHIVED",
              archivedAt: now,
              archivedReason: `Recruiter set stage to ${toStage}`,
              nextActionAt: null,
            },
          });
          break;
        case "resurrectAndFanOut":
          // Un-archive previously-closed threads (will run from scratch).
          await tx.channelThread.updateMany({
            where: { taskId, status: "ARCHIVED" },
            data: {
              status: "PENDING",
              archivedAt: null,
              archivedReason: null,
              nextActionAt: now,
              // Reset the in-flight send tracker — the previous send (if any)
              // is no longer relevant.
              pendingSendKey: null,
              pendingSendStartedAt: null,
            },
          });
          // Un-pause sibling-paused threads (e.g., paused because another
          // channel got REPLIED earlier). Recruiter has chosen to re-engage.
          await tx.channelThread.updateMany({
            where: { taskId, status: "PAUSED" },
            data: { status: "ACTIVE", nextActionAt: now },
          });
          break;
        case "fanOut":
          // Handled outside the transaction below — fanOutToChannels does its
          // own queries and doesn't accept a tx client.
          break;
      }

      return t;
    });

    // Fire-and-forget fan-out for SOURCED → SHORTLISTED and the
    // resurrectAndFanOut case. fanOutToChannels is idempotent on the unique
    // (taskId, channelId) constraint, so a no-op on existing threads is safe.
    if (
      (transition.effect === "fanOut" || transition.effect === "resurrectAndFanOut") &&
      updated.jobId
    ) {
      fanOutToChannels(taskId, updated.jobId).catch(err =>
        console.error("[Stage PATCH] fanOut failed:", err),
      );
    }

    return NextResponse.json(updated, {
      headers: { ETag: `"${updated.stageUpdatedAt.toISOString()}"` },
    });
  } catch (error) {
    console.error("[Candidate Stage] PATCH failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

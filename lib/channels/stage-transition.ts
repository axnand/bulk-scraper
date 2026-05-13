// ─── Shared stage transition helper ──────────────────────────────────────────
//
// Exposed for both the single-candidate PATCH route and the bulk-drag
// endpoint so the same transition matrix + side-effects + audit + optimistic
// concurrency live in one place.
//
// applyStageTransition(taskId, toStage, opts):
//   - validates the transition
//   - honors If-Match-style optimistic concurrency on stageUpdatedAt
//   - writes Task.stage / manualStage in a transaction with the matching
//     thread side-effect (archive / pause / resurrect / fan-out)
//   - emits an audit StageEvent (suppressed task_stage_audit trigger)
//   - kicks off fan-out asynchronously when applicable
//
// Returns a discriminated union; HTTP route adapters map each kind to a
// status code (200, 404, 409, 422).

import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";
import { fanOutToChannels } from "@/lib/channels/fan-out";

export const SYSTEM_DERIVED = new Set<CandidateStage>([
  CandidateStage.CONTACT_REQUESTED,
  CandidateStage.CONNECTED,
  CandidateStage.MESSAGED,
  CandidateStage.REPLIED,
]);

export const MANUAL_WINS = new Set<CandidateStage>([
  CandidateStage.INTERVIEW,
  CandidateStage.HIRED,
  CandidateStage.REJECTED,
  CandidateStage.ARCHIVED,
]);

export type ThreadEffect =
  | "none"
  | "fanOut"
  | "archiveOpen"
  | "pauseActive"
  | "archiveAll"
  | "resurrectAndFanOut"
  | "archiveAndFanOut"; // recruiter drags back to SHORTLISTED from an active outreach stage — start over

export type Transition =
  | { kind: "allow"; effect: ThreadEffect; setManualStage: CandidateStage | null }
  | { kind: "refuse"; reason: string };

export function evaluateTransition(from: CandidateStage, to: CandidateStage): Transition {
  if (from === to) {
    return {
      kind: "allow",
      effect: "none",
      setManualStage: MANUAL_WINS.has(to) ? to : null,
    };
  }

  // Refuse direct drags between two system-derived stages. These stages are
  // materialized from ChannelThread state — writing `task.stage` here doesn't
  // change anything in the underlying thread, so the next rollup (worker tick
  // or webhook) would correct it back. The drag would silently revert,
  // confusing the recruiter. Direct them to use SHORTLISTED as the reset
  // mechanism if they actually want to restart outreach.
  if (SYSTEM_DERIVED.has(from) && SYSTEM_DERIVED.has(to)) {
    return {
      kind: "refuse",
      reason: "This stage is managed automatically by the outreach system. To restart this candidate's outreach, move them to Shortlisted instead.",
    };
  }

  // Recruiter UI exposes columns for every stage; refusing a drag (even into
  // system-derived ones from non-system stages) breaks the kanban workflow.
  // Allow the drag, write the recruiter's intent in `stage`, skip thread
  // side-effects for system-derived targets, and let the rollup reconcile.

  let effect: ThreadEffect = "none";

  if (to === CandidateStage.INTERVIEW || to === CandidateStage.HIRED) {
    effect = "pauseActive";
  } else if (to === CandidateStage.REJECTED || to === CandidateStage.ARCHIVED) {
    effect = "archiveAll";
  } else if (to === CandidateStage.SOURCED) {
    if (
      from === CandidateStage.SHORTLISTED ||
      SYSTEM_DERIVED.has(from) ||
      from === CandidateStage.INTERVIEW ||
      from === CandidateStage.HIRED ||
      from === CandidateStage.REJECTED
    ) {
      effect = "archiveOpen";
    }
  } else if (to === CandidateStage.SHORTLISTED) {
    if (from === CandidateStage.SOURCED) {
      effect = "fanOut";
    } else if (SYSTEM_DERIVED.has(from)) {
      // Recruiter is explicitly resetting a candidate mid-outreach back to
      // SHORTLISTED. This is a "start over" signal — the previous invite/DM
      // sequence is abandoned. Archive all live threads so fan-out creates
      // fresh ones (potentially on a new account if the channel pool changed).
      effect = "archiveAndFanOut";
    } else if (
      from === CandidateStage.ARCHIVED ||
      from === CandidateStage.REJECTED ||
      from === CandidateStage.HIRED ||
      from === CandidateStage.INTERVIEW
    ) {
      effect = "resurrectAndFanOut";
    }
  }
  // Other SYSTEM_DERIVED targets fall through with effect: "none".

  return {
    kind: "allow",
    effect,
    setManualStage: MANUAL_WINS.has(to) ? to : null,
  };
}

export type ApplyTransitionInput = {
  taskId: string;
  toStage: CandidateStage;
  reason?: string | null;
  /** Optional optimistic-concurrency check. ISO string of the last-known stageUpdatedAt. */
  expectedStageUpdatedAt?: string | null;
};

export type ApplyTransitionResult =
  | {
      ok: true;
      task: { id: string; stage: CandidateStage; manualStage: CandidateStage | null; stageUpdatedAt: Date; jobId: string | null };
      effect: ThreadEffect;
    }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "concurrency_conflict"; currentStage: CandidateStage; currentStageUpdatedAt: string }
  | { ok: false; kind: "transition_refused"; reason: string }
  | { ok: false; kind: "internal"; error: string };

export async function applyStageTransition(input: ApplyTransitionInput): Promise<ApplyTransitionResult> {
  const { taskId, toStage, reason, expectedStageUpdatedAt } = input;

  try {
    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { stage: true, jobId: true, stageUpdatedAt: true },
    });
    if (!existing) {
      return { ok: false, kind: "not_found" };
    }

    if (expectedStageUpdatedAt) {
      const currentIso = existing.stageUpdatedAt.toISOString();
      if (expectedStageUpdatedAt !== currentIso) {
        return {
          ok: false,
          kind: "concurrency_conflict",
          currentStage: existing.stage,
          currentStageUpdatedAt: currentIso,
        };
      }
    }

    const transition = evaluateTransition(existing.stage, toStage);
    if (transition.kind === "refuse") {
      return { ok: false, kind: "transition_refused", reason: transition.reason };
    }

    const manualStageWrite =
      transition.setManualStage !== null
        ? { manualStage: transition.setManualStage }
        : { manualStage: null };

    const now = new Date();
    const fromStage = existing.stage;

    const updated = await prisma.$transaction(async (tx) => {
      // Suppress the task_stage_audit trigger — we write our own richer
      // StageEvent inside this transaction.
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
          fromStage,
          toStage,
          actor: "USER",
          reason: reason ?? null,
        },
      });

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
          await tx.channelThread.updateMany({
            where: { taskId, status: "ARCHIVED" },
            data: {
              status: "PENDING",
              archivedAt: null,
              archivedReason: null,
              nextActionAt: now,
              pendingSendKey: null,
              pendingSendStartedAt: null,
            },
          });
          await tx.channelThread.updateMany({
            where: { taskId, status: "PAUSED" },
            data: { status: "ACTIVE", nextActionAt: now },
          });
          break;
        case "archiveAndFanOut":
          // Archive every live thread — recruiter is starting this candidate
          // over from scratch. Fan-out (below) will create fresh threads, which
          // will pick the current account pool (may differ from the old threads).
          await tx.channelThread.updateMany({
            where: { taskId, status: { in: ["PENDING", "ACTIVE", "PAUSED"] } },
            data: {
              status: "ARCHIVED",
              archivedAt: now,
              archivedReason: "manual_reset",
              nextActionAt: null,
              pendingSendKey: null,
              pendingSendStartedAt: null,
            },
          });
          break;
        case "fanOut":
          // Run outside the transaction (below) — fanOutToChannels has its
          // own queries that wouldn't share this tx client.
          break;
      }

      return t;
    });

    if (
      (transition.effect === "fanOut" || transition.effect === "resurrectAndFanOut" || transition.effect === "archiveAndFanOut") &&
      updated.jobId
    ) {
      fanOutToChannels(taskId, updated.jobId).catch(err =>
        console.error("[applyStageTransition] fanOut failed:", err),
      );
    }

    return { ok: true, task: updated, effect: transition.effect };
  } catch (err: any) {
    console.error("[applyStageTransition] failed:", err);
    return { ok: false, kind: "internal", error: err?.message ?? "Unknown error" };
  }
}

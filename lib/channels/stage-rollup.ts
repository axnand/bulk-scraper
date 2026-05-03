// ─── Task stage rollup ────────────────────────────────────────────────────────
//
// Task.stage is a materialized rollup of all ChannelThread statuses for that task.
// Call recomputeTaskStage() after ANY thread status or providerState change.
// It respects manualStage (set by the recruiter for INTERVIEW / HIRED / REJECTED).

import { prisma } from "@/lib/prisma";
import { CandidateStage } from "@prisma/client";
import { markStageEventExplicit } from "@/lib/channels/stage-event-context";

// Stages a recruiter sets manually — these always win over any derived state.
// ARCHIVED is included so that a recruiter dragging a candidate to ARCHIVED
// is honored even if some thread is still PENDING (the side-effect of that
// drag, in the candidate PATCH route, is to archive every thread, but the
// rollup must still respect the recruiter's intent during the brief window
// before those archives commit).
const MANUAL_WINS = new Set<CandidateStage>(["INTERVIEW", "HIRED", "REJECTED", "ARCHIVED"]);

// Priority order for derived rollup (higher index = higher priority)
const STAGE_PRIORITY: Record<CandidateStage, number> = {
  SOURCED:           0,
  SHORTLISTED:       1,
  CONTACT_REQUESTED: 2,
  CONNECTED:         3,
  MESSAGED:          4,
  REPLIED:           5,
  INTERVIEW:         6,
  HIRED:             7,
  REJECTED:          8,
  ARCHIVED:         -1, // special — only wins when ALL threads are archived
};

type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export async function recomputeTaskStage(
  taskId: string,
  tx: TxClient = prisma,
): Promise<CandidateStage> {
  const [task, threads] = await Promise.all([
    tx.task.findUnique({
      where: { id: taskId },
      select: { stage: true, manualStage: true },
    }),
    tx.channelThread.findMany({
      where: { taskId },
      select: { status: true, providerState: true, lastMessageAt: true },
    }),
  ]);

  if (!task) throw new Error(`recomputeTaskStage: task ${taskId} not found`);

  // Recruiter decision always wins
  if (task.manualStage && MANUAL_WINS.has(task.manualStage)) {
    if (task.stage !== task.manualStage) {
      await tx.task.update({
        where: { id: taskId },
        data: { stage: task.manualStage, stageUpdatedAt: new Date() },
      });
    }
    return task.manualStage;
  }

  // No threads yet — leave stage as-is (SOURCED or SHORTLISTED)
  if (threads.length === 0) return task.stage;

  // All threads archived → task is archived
  if (threads.every(t => t.status === "ARCHIVED")) {
    if (task.stage !== "ARCHIVED") {
      // Wrap writes in a transaction so set_config(... is_local=true) inside
      // markStageEventExplicit persists across the task.update + stageEvent.create.
      // Without this, the audit trigger task_stage_audit would emit a duplicate row.
      await prisma.$transaction(async (innerTx) => {
        await markStageEventExplicit(innerTx);
        await innerTx.task.update({
          where: { id: taskId },
          data: { stage: "ARCHIVED", stageUpdatedAt: new Date() },
        });
        await innerTx.stageEvent.create({
          data: {
            taskId,
            fromStage: task.stage,
            toStage: "ARCHIVED",
            actor: "SYSTEM",
            reason: "All channel threads exhausted or timed out",
          },
        });
      });
    }
    return "ARCHIVED";
  }

  // Derive the highest stage from active/paused threads
  let derived: CandidateStage = "SHORTLISTED";

  for (const thread of threads) {
    if (thread.status === "ARCHIVED") continue;

    let threadStage: CandidateStage;

    if (thread.status === "REPLIED") {
      // Replied always wins — short-circuit
      derived = "REPLIED";
      break;
    } else if (thread.status === "PAUSED" || thread.status === "PENDING") {
      // Paused/pending threads don't advance the stage
      continue;
    } else {
      // ACTIVE — derive from providerState
      const ps = (thread.providerState as Record<string, string> | null) ?? {};
      if (ps.phase === "INVITE_PENDING") {
        threadStage = "CONTACT_REQUESTED";
      } else if (ps.phase === "CONNECTED" && !thread.lastMessageAt) {
        // Connected on LinkedIn but no DM has been sent yet
        threadStage = "CONNECTED";
      } else {
        // Anything else (INMAIL_SENT, SENT, DELIVERED, MESSAGED, or CONNECTED+lastMessageAt)
        // means a message has been sent → MESSAGED
        threadStage = "MESSAGED";
      }
      if (STAGE_PRIORITY[threadStage] > STAGE_PRIORITY[derived]) {
        derived = threadStage;
      }
    }
  }

  if (derived !== task.stage) {
    // Wrap writes in a transaction (see comment above on the ARCHIVED branch).
    await prisma.$transaction(async (innerTx) => {
      await markStageEventExplicit(innerTx);
      await innerTx.task.update({
        where: { id: taskId },
        data: { stage: derived, stageUpdatedAt: new Date() },
      });
      await innerTx.stageEvent.create({
        data: {
          taskId,
          fromStage: task.stage,
          toStage: derived,
          actor: "SYSTEM",
          reason: "Stage recomputed from channel thread states",
        },
      });
    });
  }

  return derived;
}

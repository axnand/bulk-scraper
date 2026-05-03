// ─── Stage-event audit context ────────────────────────────────────────────────
//
// The Postgres trigger task_stage_audit (see the
// 20260503000005_add_task_stage_audit_trigger migration) auto-inserts a
// StageEvent row whenever Task.stage changes. The trigger checks a
// transaction-local GUC (`app.stage_event_explicit`) and skips its own write
// when the app is going to insert a richer StageEvent itself.
//
// Two helpers cover the two transaction shapes we use:
//
//   ── Interactive ─────────────────────────────────────────────────────────
//   await prisma.$transaction(async (tx) => {
//     await markStageEventExplicit(tx);
//     await tx.task.update({ ... data: { stage } });
//     await tx.stageEvent.create({ data: { ..., actor: "USER" } });
//   });
//
//   ── Array form ─────────────────────────────────────────────────────────
//   await prisma.$transaction([
//     stageEventExplicit(),
//     prisma.task.update({ ... }),
//     prisma.stageEvent.create({ ... }),
//   ]);
//
// Both call set_config(name, value, is_local=true) which scopes the GUC to
// the current transaction; it cannot leak across connections or pooled
// transactions. Safe to call multiple times within the same tx.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// Anything with $executeRaw works — covers both the top-level prisma client
// and the tx callback's client.
type RawCapable = {
  $executeRaw: (
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => Promise<number>;
};

/**
 * Mark the current interactive transaction as having explicit StageEvent
 * authorship. Call this immediately before a Task.update that mutates `stage`,
 * inside `prisma.$transaction(async (tx) => …)`.
 */
export async function markStageEventExplicit(tx: RawCapable): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.stage_event_explicit', 'true', true)`;
}

/**
 * Returns a Prisma promise to inline inside `prisma.$transaction([…])` array
 * form. Place it as the first item of the array so the GUC is set before any
 * Task.update fires.
 */
export function stageEventExplicit() {
  return prisma.$executeRaw`SELECT set_config('app.stage_event_explicit', 'true', true)`;
}

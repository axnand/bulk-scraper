# Coding policy

## Task rows are append-only

Hard-deletion of `Task` rows is **forbidden** except for GDPR erasure (separate
codepath with audit log, not yet built).

The cleanup cron that deleted failed tasks was permanently retired in commit
**2646e58**. Do not re-introduce it.

Soft-deleted rows (`deletedAt IS NOT NULL`) are kept forever — they are cheap
to store and preserve audit history. Do **not** add a "purge soft-deleted"
cron. If 50 000 deleted rows accumulate in three years and you genuinely need
to purge them, write a one-off script with backups at that time.

### Automatic soft-delete filter

`lib/prisma.ts` exports an extended Prisma client that automatically injects
`deletedAt: null` into every `task.findMany`, `task.findFirst`,
`task.findFirstOrThrow`, and `task.count` call. New code cannot accidentally
list deleted tasks.

`findUnique` is intentionally **not** filtered — PK lookups are explicit and
deliberate, not accidental listings.

To bypass the filter (e.g. a future admin "deleted candidates" view), pass
`where: { deletedAt: { not: null } }`. That explicit override signals intent
clearly and is visible in code review.

### Soft-deleting a task

```ts
await prisma.task.update({
  where: { id: taskId },
  data: { deletedAt: new Date(), deletedReason: "duplicate_resolved" },
});
```

Valid `deletedReason` values (extend as needed):
- `"duplicate_resolved"` — resolved via the duplicates UI

---

## Schema migration conventions

The system has live in-flight `ChannelThread` rows + a worker (`worker.ts`) that
ticks every minute. A blocking `ALTER` or a backfill that contends for locks at
production time will stall outreach. Follow these rules whenever you touch
`prisma/schema.prisma`:

1. **Adding a column — `NULL`-able first.** Even when the eventual semantics
   are `NOT NULL`, ship the column nullable, run a backfill in a follow-up
   script, then a *second* migration tightens to `NOT NULL`. Single-shot
   `ADD COLUMN ... NOT NULL DEFAULT ...` is fine for trivially-default-able
   columns on small tables; not for `Task` or `ChannelThread`.

2. **Backfills run in chunks.** Never `UPDATE ... WHERE ...` across a large
   table in one statement. Backfill scripts under `scripts/` process 500–1000
   rows per batch, sleep briefly between batches, and are idempotent (safe to
   re-run).

3. **No destructive cron / one-off scripts without a graveyard.** Any code that
   deletes rows must dump them to a `<Table>_archive` shadow table inside the
   same transaction. The cleanup cron that violated this rule was retired
   (commit `2646e58`). Do not re-introduce it. The single allowed exception is
   an explicit admin "purge" endpoint clearly marked as such.

4. **Stage changes go through `recomputeTaskStage`.** Never raw
   `UPDATE Task SET stage = ...` in application code. A Postgres trigger
   (`task_stage_audit`) auto-inserts a `StageEvent` whenever `Task.stage`
   changes, so audit is preserved even if this rule is violated, but every
   code path should still go through the rollup so downstream effects (the
   `{changed, source}` event contract) fire correctly.

5. **Triggers and raw SQL live in migration files only.** Never inline raw SQL
   in application code. Each new trigger requires an ADR-style comment block
   in the migration explaining purpose, latency profile, and rollback.

6. **Maintenance-window changes must be flagged.** Long-running
   `CREATE INDEX`, `LOCK TABLE`, or trigger creation must include a deploy
   note in the migration directory and be paired with a quiet-window deploy.

Every migration PR must answer: *"if this code path ran 1000 times in error,
how do we recover?"* If the answer involves restoring from a backup,
redesign.

---

## Worker / cron coordination

- `worker.ts` runs the in-process tick. External cron (Railway/Vercel)
  triggers the same logic. Both call `runOutreachTick`. Any global
  serialization must use a Postgres advisory lock (single source of truth
  across both processes); in-memory mutexes do not work here.

## Stage rollup invariants

- `Task.manualStage ∈ {INTERVIEW, HIRED, REJECTED}` always wins
  (`MANUAL_WINS` in `lib/channels/stage-rollup.ts`).
- `task.stage` is materialized — never the source of truth on its own. The
  source of truth is `manualStage` ⊕ the set of `ChannelThread` statuses.
- Sibling-pause: when one thread on a Task transitions to `REPLIED`, the
  other threads on that Task move to `PAUSED`. Cross-Task propagation across
  requisitions is a separate concern (planned via `Task.candidateId`).

## Common pitfalls

- `processThread` closing transactions must use `updateMany` with a status
  guard (`{ status: { in: ['PENDING','ACTIVE'] } }`) to avoid clobbering a
  webhook-driven `REPLIED` transition.
- Webhook handlers must scope thread lookup by `(providerChatId, account.id)`,
  not `providerChatId` alone, to avoid cross-requisition collisions.
- `ChannelThread.accountId` (when added) is sticky once set; never re-derive
  from `channel.sendingAccount` after the first send — the conversation
  belongs to that account.

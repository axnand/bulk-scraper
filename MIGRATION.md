# Railway Migration + pg-boss Integration

**Stack:** Next.js web service + standalone worker service on Railway. pg-boss owns queue/retry/stall. `Task` table stays as UI source of truth. Account rotation unchanged.

---

## Phase 0 — Railway Migration

- [x] 0.1 `npm install pg-boss tsx`
- [x] 0.2 Create `worker.ts` — starts pg-boss, registers handlers, SIGTERM handler
- [ ] 0.3 Railway: `web` → `npm start`, `worker` → `npm run worker`, same repo, two services
- [ ] 0.4 Pin worker service to exactly 1 replica, disable autoscale
- [x] 0.5 pg-boss must use Railway's **direct** Postgres URL (not pgbouncer/pooled) — set `DIRECT_DATABASE_URL` env var on the worker service; `lib/queue.ts` prefers it automatically
- [x] 0.6 Delete `lib/trigger.ts`; remove `after()`, `maxDuration`, self-chain from `app/api/process-tasks/route.ts` (now a stub)

## Phase 1 — pg-boss Integration

- [x] 1.1 Create `lib/queue.ts` — singleton pg-boss with `retryLimit: 3`, `retryDelay: 30`, `retryBackoff: true`, `expireInSeconds: 300`
- [x] 1.2 In `worker.ts` register: `boss.work('process-task', { localConcurrency: 10 }, handler)` and `boss.work('process-resume-task', { localConcurrency: 5 }, handler)`
- [x] 1.3 Move task logic → `lib/workers/task-handlers.ts`; stripped optimistic claim, retry bookkeeping, stale recovery; kept account acquire/release, fetch/persist/analyze, auto-shortlist, sheet export
- [x] 1.4 Handler contract: load Task → if DONE/FAILED return → acquire account → process → success: DONE + return → retryable error: PENDING + throw → permanent error: FAILED + return
- [x] 1.5 On every Task creation: replaced `triggerProcessing()` with `enqueueTaskBatch()` in all 4 routes: `runs`, `add-candidates`, `upload-profiles`, `jobs`
- [x] 1.5b `cancel/route.ts` resume action: re-enqueues all PENDING tasks via `enqueueTaskBatch()`
- [x] 1.6 Backfill script created at `scripts/backfill-queue.ts` — run once on first deploy: `npm run worker:backfill`
- [x] 1.7 Deleted `recoverStaleState()` from `lib/services/account.service.ts`
- [x] 1.8 ✅ AbortSignal timeouts already present: 30s in `unipile.service.ts`, 60s in `ai-adapter.ts`

## Phase 2 — Safety

- [ ] 2.1 Add unique DB constraint on `Task(jobId, url)` for LinkedIn tasks; handler treats duplicate-key as already-processed (return, not throw)
- [x] 2.2 10-min Railway cron: reset `Account.status = BUSY` where no PROCESSING tasks — in `app/api/cron/process-tasks/route.ts` (stripped of old Vercel-specific logic)
- [x] 2.3 SIGTERM handler in `worker.ts`: `boss.stop({ graceful: true, timeout: 25000 })`
- [ ] 2.4 Give pg-boss its own `pg.Pool` with ~10 connections; set Prisma `connection_limit=15` in `DATABASE_URL`

## Phase 3 — Observability

- [ ] 3.1 Subscribe to pg-boss `failed` event → mark Task `FAILED` + increment `job.failedCount`
- [x] 3.2 Log queue depth + active count every 60s in worker via `boss.getQueueStats()`
- [ ] 3.3 Structured JSON logs in handlers: `{ taskId, jobId, accountId, stage, durationMs, outcome }`

## Phase 4 — Defer

- Multiple worker replicas (pg-boss supports it natively — just bump Railway replica count, zero code changes)
- Priority queues
- BullMQ migration

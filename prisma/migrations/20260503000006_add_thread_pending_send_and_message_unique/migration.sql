-- ─── Phase 3 #11 — pending-send idempotency hooks ────────────────────────────
--
-- 1. Adds two nullable columns to "ChannelThread" so the worker can record
--    that a provider API call is in flight. A future heal job will look for
--    rows where pendingSendKey IS NOT NULL AND pendingSendStartedAt < now()
--    minus 10 min and reset them.
--
-- 2. Adds a unique index on ("ThreadMessage"."threadId", "providerMessageId")
--    to refuse duplicate rows when the provider returns the same message ID
--    twice (post-retry double-send). Postgres treats NULL as distinct in
--    unique indexes, so rows with NULL providerMessageId are unaffected.
--
-- Both changes are additive and ship NULL-able / index-only, no backfill needed.

ALTER TABLE "ChannelThread"
  ADD COLUMN "pendingSendKey" TEXT,
  ADD COLUMN "pendingSendStartedAt" TIMESTAMP(3);

-- CREATE UNIQUE INDEX CONCURRENTLY would avoid the brief lock, but it's not
-- supported inside a Prisma migration (no parallel transactions). The table
-- is small enough that the lock is acceptable; revisit if it grows.
CREATE UNIQUE INDEX "ThreadMessage_threadId_providerMessageId_key"
  ON "ThreadMessage" ("threadId", "providerMessageId");

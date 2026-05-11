-- Drop the leftover unique index on OutreachMessage(campaignId, taskId).
--
-- Migration 20260426000001 (account_type_remove_campaigns) tried to drop this
-- via `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`, but it was created by an
-- earlier (squashed / db-pushed) revision as a UNIQUE INDEX, not a UNIQUE
-- CONSTRAINT — so the IF EXISTS clause silently no-op'd and the index lived on.
--
-- The schema (`prisma/schema.prisma`) has not declared this unique for some
-- time; the index now only causes runtime P2002 errors when a recruiter
-- re-sends a DM on the same channel for the same task (e.g. after manually
-- moving a candidate Contacted → Connected and triggering send-dm again).
--
-- Latency profile: trivial — `DROP INDEX` on a small table takes <1ms and an
-- ACCESS EXCLUSIVE lock for that duration. No quiet-window required.
-- Rollback: re-create with `CREATE UNIQUE INDEX "OutreachMessage_campaignId_taskId_key" ON "OutreachMessage"("campaignId","taskId")`,
-- but only after dedup'ing any duplicate (campaignId, taskId) rows that
-- accumulated since this drop.

DROP INDEX IF EXISTS "OutreachMessage_campaignId_taskId_key";

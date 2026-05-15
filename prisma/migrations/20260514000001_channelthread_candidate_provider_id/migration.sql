-- ─── candidateProviderId on ChannelThread ────────────────────────────────────
--
-- Purpose: Store the LinkedIn provider_id (URN) of the candidate at invite-send
--   time so the new_relation webhook can resolve the thread in O(1) via an
--   indexed lookup, rather than scanning all INVITE_PENDING threads and parsing
--   task.result JSON.
--
-- Latency profile: additive nullable column + one non-unique index. The index
--   CREATE is non-concurrent but the column is small; migration takes < 100 ms
--   on the current row count.
--
-- Rollback: `ALTER TABLE "ChannelThread" DROP COLUMN "candidateProviderId"` plus
--   the corresponding index DROP. The column is only read by the new codepath;
--   the JSON-scan fallback in findThreadByProviderUserId still works without it.
--
-- Backfill: not required for correctness. Threads sent before this migration
--   will have NULL; the webhook handler falls back to JSON scan for those rows.
--   A future one-off script can backfill from task.result if desired.

ALTER TABLE "ChannelThread"
  ADD COLUMN "candidateProviderId" TEXT;

CREATE INDEX "ChannelThread_candidateProviderId_status_idx"
  ON "ChannelThread" ("candidateProviderId", "status");

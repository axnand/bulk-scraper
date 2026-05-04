-- ─── P1 #34 — StageSnapshot for incident detection ──────────────────────────
--
-- Scheduled job (app/api/cron/stage-snapshot) inserts one row per
-- (requisitionId, stage) per capture window. Anomaly detection compares
-- consecutive snapshots; large drops trigger an alert.
--
-- Idempotent on (capturedAt, requisitionId, stage) so re-running the cron
-- in the same window is a no-op (insert-on-conflict-ignore).
--
-- requisitionId is nullable so the snapshot can also include legacy Tasks
-- that aren't yet linked to a Requisition (Job.requisitionId IS NULL).

CREATE TABLE "StageSnapshot" (
  "id"            TEXT          NOT NULL,
  "capturedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "requisitionId" TEXT,
  "stage"         "CandidateStage" NOT NULL,
  "count"         INTEGER       NOT NULL,

  CONSTRAINT "StageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StageSnapshot_capturedAt_requisitionId_stage_key"
  ON "StageSnapshot" ("capturedAt", "requisitionId", "stage");

CREATE INDEX "StageSnapshot_requisitionId_capturedAt_idx"
  ON "StageSnapshot" ("requisitionId", "capturedAt");

CREATE INDEX "StageSnapshot_capturedAt_stage_idx"
  ON "StageSnapshot" ("capturedAt", "stage");

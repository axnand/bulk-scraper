-- ─── P1 #37 — Task.analysisStatus tri-state ─────────────────────────────────
--
-- Distinct from Task.status (whole task lifecycle: scrape + analyze + persist),
-- analysisStatus tracks specifically whether the AI analysis sub-step
-- succeeded. Required to surface "AI failed permanently, needs manual review"
-- candidates in the recruiter UI — currently those tasks are stranded at
-- SOURCED with no signal.
--
-- States:
--   PENDING  - not yet run / in flight / skipped because no JD configured.
--   OK       - analyzed successfully, scorePercent populated.
--   FAILED   - retries exhausted (provider down, malformed JSON, OOM, etc.).
--
-- Additive + nullable-safe via DEFAULT — no backfill required. Existing rows
-- get 'PENDING' on read (PG fast-default), new code that sets the column
-- writes the right value.

CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'OK', 'FAILED');

ALTER TABLE "Task"
  ADD COLUMN "analysisStatus" "AnalysisStatus" NOT NULL DEFAULT 'PENDING';

-- Index supporting the recruiter "needs review" filter:
--   SELECT * FROM "Task" WHERE "jobId" = $1 AND "analysisStatus" = 'FAILED'
CREATE INDEX "Task_jobId_analysisStatus_idx"
  ON "Task" ("jobId", "analysisStatus");

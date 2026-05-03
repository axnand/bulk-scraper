-- ─── Phase 6 #27 — Canonical candidate identity ───────────────────────────────
--
-- Adds:
--   1. CandidateProfile.canonicalLinkedinUrl  — application-computed canonical
--      form (`linkedin.com/in/<slug>`) used as the cross-task identity join
--      key. Nullable initially. NO unique constraint yet — pre-existing data
--      contains some duplicates that a follow-up dedup migration will
--      collapse before adding @unique.
--
--   2. Task.candidateProfileId  — FK to CandidateProfile.id. Nullable for
--      backwards compatibility with legacy Tasks. Newly-processed Tasks set
--      this via the persist-linkedin-result pipeline; a backfill script
--      links pre-existing Tasks once the helper is wired.
--
--   3. Two new indexes for the cross-task lookup pattern.
--
-- Both columns are NULL-able and additive — no backfill required to apply.

ALTER TABLE "CandidateProfile" ADD COLUMN "canonicalLinkedinUrl" TEXT;
CREATE INDEX "CandidateProfile_canonicalLinkedinUrl_idx"
  ON "CandidateProfile"("canonicalLinkedinUrl");

ALTER TABLE "Task" ADD COLUMN "candidateProfileId" TEXT;
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_candidateProfileId_fkey"
  FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Task_candidateProfileId_idx"
  ON "Task"("candidateProfileId");

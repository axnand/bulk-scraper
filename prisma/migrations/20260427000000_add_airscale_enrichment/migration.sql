-- Create CandidateContact table (idempotent)
CREATE TABLE IF NOT EXISTS "CandidateContact" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "email" TEXT,
    "linkedinEmail" TEXT,
    "personalEmail" TEXT,
    "workEmail" TEXT,
    "phone" TEXT,
    "salary" TEXT,
    "source" TEXT,
    "confidence" DOUBLE PRECISION,
    "enrichedAt" TIMESTAMP(3),

    CONSTRAINT "CandidateContact_pkey" PRIMARY KEY ("id")
);

-- Unique index on taskId (1:1 with Task)
CREATE UNIQUE INDEX IF NOT EXISTS "CandidateContact_taskId_key" ON "CandidateContact"("taskId");

-- FK to Task — only add if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CandidateContact_taskId_fkey'
      AND conrelid = '"CandidateContact"'::regclass
  ) THEN
    ALTER TABLE "CandidateContact"
      ADD CONSTRAINT "CandidateContact_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE
      NOT VALID;
  END IF;
END $$;

-- Add new enrichment columns if they don't exist yet
ALTER TABLE "CandidateContact" ADD COLUMN IF NOT EXISTS "linkedinEmail" TEXT;
ALTER TABLE "CandidateContact" ADD COLUMN IF NOT EXISTS "personalEmail" TEXT;
ALTER TABLE "CandidateContact" ADD COLUMN IF NOT EXISTS "workEmail" TEXT;
ALTER TABLE "CandidateContact" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "CandidateContact" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;
ALTER TABLE "CandidateContact" ADD COLUMN IF NOT EXISTS "enrichedAt" TIMESTAMP(3);

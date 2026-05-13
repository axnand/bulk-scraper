-- CreateTable: GdprErasure
-- Permanent audit log for GDPR hard-erasure actions. Stores a snapshot of
-- key identifiers (taskId, url, name, stage) BEFORE deletion so there is a
-- durable record that erasure happened even though the underlying data is gone.
-- One row per recruiter-triggered erase action (may cover many task IDs).
CREATE TABLE "GdprErasure" (
    "id"           TEXT NOT NULL,
    "erasedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erasedBy"     TEXT NOT NULL DEFAULT 'recruiter',
    "taskCount"    INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,

    CONSTRAINT "GdprErasure_pkey" PRIMARY KEY ("id")
);

-- Task rows are append-only. This migration adds the soft-delete fields.
-- Hard-deletion is forbidden except for GDPR erasure (separate codepath).
-- See the policy comment in schema.prisma above the Task model.

ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN "deletedReason" TEXT;

CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");

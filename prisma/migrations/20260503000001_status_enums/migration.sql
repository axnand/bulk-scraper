-- Convert string status fields to native Postgres enums for type safety.
-- All current values in production already match these enum labels (verified
-- against schema comments + code grep).

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'BUSY', 'COOLDOWN', 'DISABLED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED');
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
CREATE TYPE "DuplicateKind" AS ENUM ('LINKEDIN_URL', 'RESUME_HASH');
CREATE TYPE "DuplicateStatus" AS ENUM ('PENDING', 'RESOLVED_DELETED_A', 'RESOLVED_DELETED_B', 'RESOLVED_KEPT_BOTH');
CREATE TYPE "ThreadMessageStatus" AS ENUM ('SENT', 'FAILED');

-- ─── Account.status ───────────────────────────────────────────────────────

ALTER TABLE "Account"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "AccountStatus" USING "status"::"AccountStatus",
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- ─── Job.status ───────────────────────────────────────────────────────────

ALTER TABLE "Job"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "JobStatus" USING "status"::"JobStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ─── Task.status ──────────────────────────────────────────────────────────

ALTER TABLE "Task"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::"TaskStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ─── DuplicatePair.kind / DuplicatePair.status ────────────────────────────

ALTER TABLE "DuplicatePair"
  ALTER COLUMN "kind" TYPE "DuplicateKind" USING "kind"::"DuplicateKind";

ALTER TABLE "DuplicatePair"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "DuplicateStatus" USING "status"::"DuplicateStatus",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ─── ThreadMessage.status ─────────────────────────────────────────────────

ALTER TABLE "ThreadMessage"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ThreadMessageStatus" USING "status"::"ThreadMessageStatus",
  ALTER COLUMN "status" SET DEFAULT 'SENT';

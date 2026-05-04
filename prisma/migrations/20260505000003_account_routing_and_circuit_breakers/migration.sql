-- ─── P1 #14 + #27 + #39 + #41 — multi-account routing + circuit breakers ────
--
-- One coordinated additive migration. All columns are NULL-able or have
-- DEFAULT values so the previously-deployed Prisma client (which doesn't
-- know about these columns) keeps working: it simply doesn't include them
-- in SELECTs or INSERTs, and DB-side defaults fill in.
--
-- Changes:
--   1. Account.weeklyCount / weeklyResetAt    — LinkedIn weekly invite limit
--   2. Account.warmupUntil                     — fresh-account ramp window
--   3. ChannelThread.consecutiveFailures       — circuit breaker counter
--   4. ChannelThread.lastInboundAt             — WhatsApp 24h window tracker
--   5. ChannelAccountPool (new table)          — per-channel account routing pool
--
-- Inactive until application code is updated to read/write them. Until then,
-- defaults apply and old behaviour is preserved.

-- ─── 1. Account: weekly + warmup tracking ─────────────────────────────────
ALTER TABLE "Account"
  ADD COLUMN "weeklyCount"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "weeklyResetAt" TIMESTAMP(3),
  ADD COLUMN "warmupUntil"   TIMESTAMP(3);

-- ─── 2. ChannelThread: circuit breaker + WA inbound tracker ───────────────
ALTER TABLE "ChannelThread"
  ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastInboundAt"       TIMESTAMP(3);

-- ─── 3. ChannelAccountPool — per-channel routing pool ─────────────────────
CREATE TABLE "ChannelAccountPool" (
  "id"        TEXT          NOT NULL,
  "channelId" TEXT          NOT NULL,
  "accountId" TEXT          NOT NULL,
  "priority"  INTEGER       NOT NULL DEFAULT 0,
  "weight"    INTEGER       NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ChannelAccountPool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelAccountPool_channelId_accountId_key"
  ON "ChannelAccountPool" ("channelId", "accountId");

CREATE INDEX "ChannelAccountPool_channelId_priority_idx"
  ON "ChannelAccountPool" ("channelId", "priority");

ALTER TABLE "ChannelAccountPool"
  ADD CONSTRAINT "ChannelAccountPool_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelAccountPool"
  ADD CONSTRAINT "ChannelAccountPool_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Phase 5 #20+#21+#23 — sticky account binding + Account soft-delete ──────
--
-- 1. ChannelThread.accountId — sticky per-thread account binding. Set at first
--    send by the worker; immutable thereafter. The conversation history (DM
--    chat, WhatsApp number, email Message-ID chain) lives on this account, so
--    follow-ups must always come from the same account.
--
-- 2. ThreadMessage.accountId — frozen-at-send forensic record of which account
--    sent each message. Survives Channel.sendingAccountId changes.
--
-- 3. Account.deletedAt — soft delete. Channels referring to a deleted account
--    do NOT cascade-null; they keep the FK so historical attribution survives.
--    Selection logic (acquireAccount, channel admin UI) filters out
--    deletedAt IS NOT NULL accounts. The worker's account-health gate also
--    treats deletedAt-set accounts as DISABLED.
--
-- All three columns are NULL-able and additive — no backfill needed.

ALTER TABLE "ChannelThread" ADD COLUMN "accountId" TEXT;
ALTER TABLE "ChannelThread"
  ADD CONSTRAINT "ChannelThread_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ChannelThread_accountId_idx" ON "ChannelThread"("accountId");

ALTER TABLE "ThreadMessage" ADD COLUMN "accountId" TEXT;
ALTER TABLE "ThreadMessage"
  ADD CONSTRAINT "ThreadMessage_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ThreadMessage_accountId_idx" ON "ThreadMessage"("accountId");

ALTER TABLE "Account" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "Account_deletedAt_idx" ON "Account"("deletedAt");

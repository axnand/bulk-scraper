-- Index on Channel.sendingAccountId — every outreach tick joins through this FK
-- to load the sending account; without an index this is a sequential scan.
CREATE INDEX IF NOT EXISTS "Channel_sendingAccountId_idx" ON "Channel"("sendingAccountId");

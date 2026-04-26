-- Create AccountType enum
CREATE TYPE "AccountType" AS ENUM ('LINKEDIN', 'EMAIL', 'WHATSAPP');

-- Add type column to Account (default LINKEDIN for all existing rows)
ALTER TABLE "Account" ADD COLUMN "type" "AccountType" NOT NULL DEFAULT 'LINKEDIN';

-- Drop FK from OutreachMessage.campaignId → Campaign.id
ALTER TABLE "OutreachMessage" DROP CONSTRAINT IF EXISTS "OutreachMessage_campaignId_fkey";

-- Drop unique constraint on OutreachMessage(campaignId, taskId)
ALTER TABLE "OutreachMessage" DROP CONSTRAINT IF EXISTS "OutreachMessage_campaignId_taskId_key";

-- Add index on OutreachMessage.providerChatId for webhook reply matching
CREATE INDEX IF NOT EXISTS "OutreachMessage_providerChatId_idx" ON "OutreachMessage"("providerChatId");

-- Drop FK from Campaign.sendingAccountId → Account.id
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_sendingAccountId_fkey";

-- Drop FK from Campaign.requisitionId → Requisition.id
ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_requisitionId_fkey";

-- Drop Campaign table
DROP TABLE IF EXISTS "Campaign";

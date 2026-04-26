-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('LINKEDIN', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('PENDING', 'ACTIVE', 'REPLIED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OutreachType" AS ENUM ('INVITE', 'INMAIL', 'FIRST_DM', 'EMAIL', 'FOLLOWUP', 'WHATSAPP');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "manualStage" "CandidateStage";

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL,
    "sendingAccountId" TEXT,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "dailyInMailCap" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelThread" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelType" "ChannelType" NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'PENDING',
    "providerState" JSONB,
    "matchedRuleKey" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "inviteSentAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "followupsSent" INTEGER NOT NULL DEFAULT 0,
    "followupsTotal" INTEGER NOT NULL DEFAULT 0,
    "providerChatId" TEXT,
    "providerThreadId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThreadMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "type" "OutreachType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "renderedBody" TEXT NOT NULL,
    "renderedSubject" TEXT,
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerChatId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Channel_requisitionId_type_status_idx" ON "Channel"("requisitionId", "type", "status");

-- CreateIndex
CREATE INDEX "ChannelThread_status_nextActionAt_idx" ON "ChannelThread"("status", "nextActionAt");

-- CreateIndex
CREATE INDEX "ChannelThread_channelType_status_idx" ON "ChannelThread"("channelType", "status");

-- CreateIndex
CREATE INDEX "ChannelThread_taskId_idx" ON "ChannelThread"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelThread_taskId_channelId_key" ON "ChannelThread"("taskId", "channelId");

-- CreateIndex
CREATE INDEX "ThreadMessage_threadId_type_idx" ON "ThreadMessage"("threadId", "type");

-- CreateIndex
CREATE INDEX "ThreadMessage_threadId_createdAt_idx" ON "ThreadMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_eventType_receivedAt_idx" ON "WebhookEvent"("provider", "eventType", "receivedAt");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_sendingAccountId_fkey" FOREIGN KEY ("sendingAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelThread" ADD CONSTRAINT "ChannelThread_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelThread" ADD CONSTRAINT "ChannelThread_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadMessage" ADD CONSTRAINT "ThreadMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChannelThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;


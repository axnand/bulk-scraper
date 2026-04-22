-- AlterTable
ALTER TABLE "Task" ADD COLUMN "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "Task_contentHash_idx" ON "Task"("contentHash");

-- CreateTable
CREATE TABLE "Requisition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled Role',
    "department" TEXT NOT NULL DEFAULT '',
    "config" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requisition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Requisition_archived_idx" ON "Requisition"("archived");

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "requisitionId" TEXT;

-- CreateIndex
CREATE INDEX "Job_requisitionId_idx" ON "Job"("requisitionId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

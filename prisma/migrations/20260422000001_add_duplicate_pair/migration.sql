CREATE TABLE "DuplicatePair" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "taskAId" TEXT NOT NULL,
  "taskBId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "matchValue" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuplicatePair_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "DuplicatePair" ADD CONSTRAINT "DuplicatePair_taskAId_fkey" FOREIGN KEY ("taskAId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuplicatePair" ADD CONSTRAINT "DuplicatePair_taskBId_fkey" FOREIGN KEY ("taskBId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuplicatePair" ADD CONSTRAINT "DuplicatePair_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "DuplicatePair_taskAId_taskBId_key" ON "DuplicatePair"("taskAId", "taskBId");
CREATE INDEX "DuplicatePair_requisitionId_status_idx" ON "DuplicatePair"("requisitionId", "status");
CREATE INDEX "DuplicatePair_taskAId_idx" ON "DuplicatePair"("taskAId");
CREATE INDEX "DuplicatePair_taskBId_idx" ON "DuplicatePair"("taskBId");

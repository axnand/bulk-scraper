-- CreateTable
CREATE TABLE "CandidateProfile" (
    "id" TEXT NOT NULL,
    "linkedinUrl" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "rawProfile" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRecord" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "linkedinUrl" TEXT NOT NULL,
    "candidateName" TEXT NOT NULL DEFAULT '',
    "jobTitle" TEXT NOT NULL,
    "jobDescription" TEXT NOT NULL,
    "scoringConfig" TEXT NOT NULL,
    "analysisData" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "scorePercent" DOUBLE PRECISION NOT NULL,
    "recommendation" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateProfile_linkedinUrl_idx" ON "CandidateProfile"("linkedinUrl");

-- CreateIndex
CREATE INDEX "CandidateProfile_scrapedAt_idx" ON "CandidateProfile"("scrapedAt");

-- CreateIndex
CREATE INDEX "AnalysisRecord_linkedinUrl_idx" ON "AnalysisRecord"("linkedinUrl");

-- CreateIndex
CREATE INDEX "AnalysisRecord_analyzedAt_idx" ON "AnalysisRecord"("analyzedAt");

-- CreateIndex
CREATE INDEX "AnalysisRecord_scorePercent_idx" ON "AnalysisRecord"("scorePercent");

-- CreateIndex
CREATE INDEX "AnalysisRecord_candidateId_idx" ON "AnalysisRecord"("candidateId");

-- AddForeignKey
ALTER TABLE "AnalysisRecord" ADD CONSTRAINT "AnalysisRecord_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


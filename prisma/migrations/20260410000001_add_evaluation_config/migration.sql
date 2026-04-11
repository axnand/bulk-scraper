-- CreateTable
CREATE TABLE "EvaluationConfig" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "promptRole" TEXT,
    "criticalInstructions" TEXT,
    "promptGuidelines" TEXT,
    "scoringRules" TEXT NOT NULL,
    "customScoringRules" TEXT NOT NULL,
    "builtInRuleDescriptions" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationConfig_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "criticalInstructions" TEXT;

-- AlterTable
ALTER TABLE "JdTemplate" ADD COLUMN "builtInRuleDescriptions" TEXT NOT NULL DEFAULT '{}';

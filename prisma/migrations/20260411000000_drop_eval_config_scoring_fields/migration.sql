-- Drop unused scoring columns from EvaluationConfig.
-- Scoring config now lives exclusively in JdTemplate; EvaluationConfig holds prompt config only.
ALTER TABLE "EvaluationConfig" DROP COLUMN "scoringRules";
ALTER TABLE "EvaluationConfig" DROP COLUMN "customScoringRules";
ALTER TABLE "EvaluationConfig" DROP COLUMN "builtInRuleDescriptions";

-- Add fully-configurable rule definitions + prompt envelope JSON columns to EvaluationConfig.
-- Both are nullable — NULL means "use built-in defaults".
ALTER TABLE "EvaluationConfig" ADD COLUMN "ruleDefinitions" TEXT;
ALTER TABLE "EvaluationConfig" ADD COLUMN "promptEnvelope" TEXT;

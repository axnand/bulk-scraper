-- Enforce at most one default per template/config table. Prisma's schema syntax
-- can't express partial unique indexes, so apply via raw SQL. The next
-- `prisma migrate dev` may detect schema drift and offer to update — accept that.

-- Before adding the constraint, demote duplicate defaults (keep the most recent).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "updatedAt" DESC) AS rn
  FROM "PromptTemplate"
  WHERE "isDefault" = true
)
UPDATE "PromptTemplate" SET "isDefault" = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "updatedAt" DESC) AS rn
  FROM "EvaluationConfig"
  WHERE "isDefault" = true
)
UPDATE "EvaluationConfig" SET "isDefault" = false
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "PromptTemplate_unique_default"
  ON "PromptTemplate" ("isDefault") WHERE "isDefault" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "EvaluationConfig_unique_default"
  ON "EvaluationConfig" ("isDefault") WHERE "isDefault" = true;

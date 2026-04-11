-- Add secretKey column to AiProvider for AWS Bedrock credentials.
-- Null for all existing providers (OpenAI-compatible, Anthropic).
ALTER TABLE "AiProvider" ADD COLUMN "secretKey" TEXT;

-- ─── Corrective: task_stage_audit trigger without pgcrypto dependency ───────
--
-- The original migration (20260503000005) used gen_random_bytes(12), which
-- requires the pgcrypto extension. Not every Supabase / Postgres deployment
-- has pgcrypto enabled, and we cannot rely on its presence. When the trigger
-- fired without pgcrypto, every Task.stage UPDATE failed with
-- `function gen_random_bytes(integer) does not exist`, breaking auto-shortlist
-- and stage rollup.
--
-- This migration replaces the function body to use gen_random_uuid(), which
-- is core in PostgreSQL 13+ and requires no extension. The behavioural
-- contract is identical:
--   - Fires AFTER UPDATE OF stage when OLD.stage IS DISTINCT FROM NEW.stage.
--   - Skips when current_setting('app.stage_event_explicit', true) = 'true'
--     (the app suppression marker).
--   - Otherwise inserts a StageEvent with actor='TRIGGER'.
--
-- Idempotent: safe to re-run. Drop+recreate the trigger to ensure the
-- WHEN clause and event signature are correct, even if the previous version
-- was patched out-of-band by hand.
--
-- ROLLBACK:
--   DROP TRIGGER task_stage_audit ON "Task";
--   DROP FUNCTION public.task_stage_audit_fn();

-- Drop existing trigger first; CASCADE on the function would also work but
-- this keeps the dependency explicit.
DROP TRIGGER IF EXISTS task_stage_audit ON "Task";

CREATE OR REPLACE FUNCTION public.task_stage_audit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_explicit text;
BEGIN
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  v_explicit := current_setting('app.stage_event_explicit', true);
  IF v_explicit = 'true' THEN
    RETURN NEW;
  END IF;

  INSERT INTO "StageEvent" (id, "taskId", "fromStage", "toStage", actor, reason, "createdAt")
  VALUES (
    'evt_' || replace(gen_random_uuid()::text, '-', ''),
    NEW.id,
    OLD.stage,
    NEW.stage,
    'TRIGGER',
    'auto-recorded (app did not declare context)',
    now()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER task_stage_audit
  AFTER UPDATE OF stage ON "Task"
  FOR EACH ROW
  WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.task_stage_audit_fn();

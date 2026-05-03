-- ─── Task.stage audit trigger ────────────────────────────────────────────────
--
-- PURPOSE:
--   Guarantees that every change to "Task"."stage" produces a "StageEvent"
--   row, even if the change comes from a raw SQL UPDATE that bypassed
--   application code. This is a defence-in-depth safety net for the audit
--   trail — the 2026-04-29 mass-stage-reset incident would have been
--   captured day-one with this trigger in place.
--
-- COORDINATION WITH APP:
--   Application code that already writes its own StageEvent (with rich
--   actor/reason context) must mark the transaction by calling
--   markStageEventExplicit() — see lib/channels/stage-event-context.ts.
--   This sets a transaction-local GUC the trigger reads to suppress its
--   own write, preventing duplicate audit rows. If the GUC is unset
--   (raw SQL, missed call site, future bug), the trigger fires with
--   actor='TRIGGER' so the audit trail is never missing.
--
-- LATENCY:
--   AFTER UPDATE OF stage means the trigger only fires when the UPDATE
--   actually targets the stage column. The WHEN clause further restricts
--   to actual stage value changes. Cost: one extra INSERT into StageEvent
--   per genuine stage transition.
--
-- ROLLBACK:
--   DROP TRIGGER task_stage_audit ON "Task";
--   DROP FUNCTION public.task_stage_audit_fn();
--
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.task_stage_audit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_explicit text;
BEGIN
  -- Defensive: the WHEN clause already gates this, but keep the check.
  IF OLD.stage IS NOT DISTINCT FROM NEW.stage THEN
    RETURN NEW;
  END IF;

  -- If the app code in this transaction set the GUC to 'true', it means it
  -- has written (or will write) its own StageEvent with rich context.
  -- Skip the trigger's own write to avoid duplicate rows.
  v_explicit := current_setting('app.stage_event_explicit', true);
  IF v_explicit = 'true' THEN
    RETURN NEW;
  END IF;

  -- Otherwise: emit a fallback StageEvent so the audit trail is preserved
  -- regardless of how the stage column was mutated.
  INSERT INTO "StageEvent" (id, "taskId", "fromStage", "toStage", actor, reason, "createdAt")
  VALUES (
    'evt_' || encode(gen_random_bytes(12), 'hex'),
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

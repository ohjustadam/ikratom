-- 0119: Auto-create a "5 calls this week" goal on user's first
-- finalized call. Gamification — gives a meaningful next target the
-- moment someone breaks the ice.
--
-- Trigger fires on call_sessions UPDATE when ended_at transitions to
-- non-null (same condition as the existing achievements trigger). If
-- this user has zero other ended calls AND no existing active goal,
-- create one.
--
-- Idempotent — the unique check on "has active goal" prevents
-- double-creating if the user already manually set one.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_auto_first_call_goal ON call_sessions;
--   DROP FUNCTION IF EXISTS public.auto_first_call_goal();

CREATE OR REPLACE FUNCTION public.auto_first_call_goal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_calls int;
  v_has_active_goal boolean;
BEGIN
  -- Only fire on call finalization (ended_at transitions null → set)
  IF new.ended_at IS NULL OR old.ended_at IS NOT NULL THEN
    RETURN new;
  END IF;

  -- Is this their first finalized call?
  SELECT count(*) INTO v_total_calls
    FROM call_sessions
    WHERE user_id = new.user_id AND ended_at IS NOT NULL;
  IF v_total_calls <> 1 THEN
    RETURN new;
  END IF;

  -- Do they already have an active goal? Don't overwrite user intent.
  SELECT EXISTS (
    SELECT 1 FROM call_goals
    WHERE user_id = new.user_id
      AND achieved_at IS NULL
  ) INTO v_has_active_goal;
  IF v_has_active_goal THEN
    RETURN new;
  END IF;

  -- Auto-create a "5 calls this week" target. Week boundary = 7 days
  -- from now (sliding) so it feels personal rather than mid-week
  -- truncated. Start counting from this call onward.
  INSERT INTO call_goals (user_id, kind, target, period, starts_at, ends_at, achieved_count)
  VALUES (
    new.user_id,
    'count',
    5,
    'week',
    new.started_at,
    new.started_at + interval '7 days',
    1   -- this call counts toward it
  );

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_first_call_goal ON call_sessions;
CREATE TRIGGER trg_auto_first_call_goal
  AFTER UPDATE OF ended_at ON call_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_first_call_goal();

COMMENT ON FUNCTION public.auto_first_call_goal() IS
  'On the user''s first finalized call, auto-creates a 5-calls-this-week goal if they don''t already have an active one. Drives momentum after the hardest call (the first).';

-- 0111: Welcome notification trigger for state briefings.
--
-- When a user completes their profile by setting `state`, fire a welcome
-- notification linking them to their state briefing IF:
--   1. site_settings('state_briefing_welcome_enabled') is true (default false)
--   2. That state has briefing_gen_enabled = true (i.e. owner has approved it)
--   3. The user hasn't already received this notification (one-shot)
--
-- The flag stays OFF until the owner reviews each state. Trigger code
-- is wired now; the gate keeps it silent until explicitly enabled.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_welcome_state_briefing ON public.profiles;
--   DROP FUNCTION IF EXISTS public.notify_state_briefing_on_state_set();

CREATE OR REPLACE FUNCTION public.notify_state_briefing_on_state_set()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag_enabled boolean := false;
  v_state_enabled boolean := false;
  v_already_sent boolean := false;
BEGIN
  -- Only fire when state transitions from null/empty → set, or changes
  IF new.state IS NULL OR new.state = '' THEN
    RETURN new;
  END IF;
  IF tg_op = 'UPDATE' AND old.state IS NOT DISTINCT FROM new.state THEN
    RETURN new;
  END IF;

  -- Gate 1: global feature flag
  SELECT (value)::text = 'true'
    INTO v_flag_enabled
    FROM public.site_settings
    WHERE key = 'state_briefing_welcome_enabled'
    LIMIT 1;
  IF NOT COALESCE(v_flag_enabled, false) THEN
    RETURN new;
  END IF;

  -- Gate 2: this state's briefing gen is enabled (i.e. owner has approved it)
  SELECT briefing_gen_enabled
    INTO v_state_enabled
    FROM public.states
    WHERE abbr = new.state
    LIMIT 1;
  IF NOT COALESCE(v_state_enabled, false) THEN
    RETURN new;
  END IF;

  -- Gate 3: don't re-send. One welcome per (user, state). Match on
  -- the link URL (which encodes the state) since notifications table
  -- has no payload column — link IS the state proof.
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = new.id
      AND kind = 'state_briefing_welcome'
      AND link = '/briefings/state/' || new.state
  ) INTO v_already_sent;
  IF v_already_sent THEN
    RETURN new;
  END IF;

  -- Fire it. notifications schema: user_id, kind, title, body, link.
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    new.id,
    'state_briefing_welcome',
    'Your ' || new.state || ' kratom briefing is ready',
    'We synthesized everything moving in ' || new.state ||
      ' right now — active bills, key reps, capital access. Print it before your next meeting.',
    '/briefings/state/' || new.state
  );

  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Never block profile writes on notification generation
  RAISE WARNING 'notify_state_briefing_on_state_set failed for user %: %', new.id, sqlerrm;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_welcome_state_briefing ON public.profiles;
CREATE TRIGGER trg_welcome_state_briefing
  AFTER INSERT OR UPDATE OF state
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_state_briefing_on_state_set();

COMMENT ON FUNCTION public.notify_state_briefing_on_state_set IS
  'Fires a welcome notification linking the user to their state briefing when their profile state is set. Three gates: site_settings flag, per-state gen_enabled, never-already-sent. Currently OFF by default; owner flips via site_settings.';

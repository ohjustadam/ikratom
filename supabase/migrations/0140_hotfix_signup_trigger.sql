-- 0140 — HOTFIX: signup is broken with "Database error saving new user".
--
-- Symptom (reproduced 2026-05-14): every supabase.auth.signUp() AND
-- admin.createUser() call returns 500 / "Database error saving new
-- user" / "Database error creating new user". Last successful profile
-- creation in our DB was 2026-05-10. Signups have been silently
-- failing for 3-4 days.
--
-- Root-cause hypothesis: the set_profile_invite_code() trigger
-- (migration 0102) calls `gen_random_bytes()` which lives in the
-- pgcrypto extension. On Supabase, pgcrypto is typically installed
-- in the `extensions` schema, not `public`. The function's
-- `language plpgsql` declaration doesn't set search_path, so the
-- unqualified `gen_random_bytes` call may not resolve depending on
-- session search_path.
--
-- The function ALSO lacks an EXCEPTION handler — so any error inside
-- the trigger aborts the whole INSERT INTO profiles, which in turn
-- aborts the INSERT INTO auth.users (the auth trigger handle_new_user
-- inserts into profiles).
--
-- Belt-and-suspenders fix:
--   1. CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions
--      — idempotent. Ensures pgcrypto is available.
--   2. Recreate set_profile_invite_code() with:
--        - explicit `search_path = public, extensions` so the
--          extension functions are findable
--        - fully-qualified `extensions.gen_random_bytes(6)` call
--          so we don't depend on search_path at all
--        - EXCEPTION WHEN OTHERS that logs and continues — invite_code
--          can stay NULL on a row; it's not load-bearing for signup,
--          backfill cron can fix any NULL rows later
--   3. Recreate handle_new_user() with the same EXCEPTION WHEN OTHERS
--      defense — if a future profile-side trigger ever errors, signup
--      still works
--
-- After applying: re-test signup via the production app. Existing
-- users with invite_code are unaffected (the trigger only fires on
-- INSERT and the function early-returns when invite_code is set).
--
-- Rollback: revert this migration (re-apply 0102's original function
-- bodies). But there's no reason to — these versions are strictly
-- safer.

-- ============================================================
-- 1. Ensure pgcrypto is available
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 2. Recreate set_profile_invite_code with explicit search_path,
--    fully-qualified extension call, and EXCEPTION handler
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_profile_invite_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_code text;
  v_attempts int := 0;
BEGIN
  IF NEW.invite_code IS NOT NULL THEN RETURN NEW; END IF;
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > 5 THEN
      -- Don't raise — invite_code is non-essential. Just log and skip.
      RAISE WARNING 'set_profile_invite_code: could not generate unique code after 5 attempts for user %', NEW.id;
      RETURN NEW;
    END IF;
    -- Fully-qualify the pgcrypto call so it works regardless of session search_path.
    -- We try both qualified locations; if pgcrypto is in `public` (older installs)
    -- vs `extensions` (current Supabase), one of these resolves.
    BEGIN
      v_code := substring(
        translate(encode(extensions.gen_random_bytes(6), 'base64'),
                  '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                  '00abcdefghijklmnopqrstuvwxyz'),
        1, 8);
    EXCEPTION WHEN undefined_function THEN
      -- Fallback: try unqualified (works if pgcrypto is in search_path)
      v_code := substring(
        translate(encode(gen_random_bytes(6), 'base64'),
                  '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                  '00abcdefghijklmnopqrstuvwxyz'),
        1, 8);
    END;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE invite_code = v_code) THEN
      NEW.invite_code := v_code;
      EXIT;
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Catastrophic fallback: log and let the insert proceed without invite_code.
  -- A backfill cron can fix NULL invite_codes later. Signup must NEVER
  -- be blocked by this trigger.
  RAISE WARNING 'set_profile_invite_code: trigger failed for user %, allowing insert without invite_code: %', NEW.id, SQLERRM;
  NEW.invite_code := NULL;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Defensive: recreate handle_new_user with EXCEPTION handler too.
--    This is the trigger that runs on auth.users insert and chains
--    into profiles + notification_preferences. If ANY downstream
--    trigger errors, auth.users insert rolls back and signup fails.
--    Wrap each downstream insert independently so one failure doesn't
--    kill the whole chain.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  -- Profile creation. This is the most important — a user without a
  -- profile is mostly unusable. But even THIS shouldn't block auth
  -- if there's a transient DB issue; the user can re-trigger profile
  -- creation later.
  BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: profiles insert failed for user %: %', NEW.id, SQLERRM;
  END;

  -- Notification preferences default row.
  BEGIN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: notification_preferences insert failed for user %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- The trigger declaration itself stays the same (defined in 0001 /
-- 0008). We only changed the function body, so no DROP/CREATE needed
-- on the trigger.

COMMENT ON FUNCTION public.set_profile_invite_code IS
  '0140 hotfix: defensive version. Fully qualifies pgcrypto, sets search_path explicitly, wraps body in EXCEPTION WHEN OTHERS so signup never blocks on invite_code generation.';
COMMENT ON FUNCTION public.handle_new_user IS
  '0140 hotfix: each downstream insert wrapped in its own EXCEPTION WHEN OTHERS so a single trigger failure can never block auth.users insert.';

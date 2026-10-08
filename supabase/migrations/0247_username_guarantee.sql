-- 0247_username_guarantee.sql
--
-- WHY: public anonymity is a hard product rule — every public surface renders
-- identity ONLY via publicHandle() → @username. On 2026-08-22 an audit found
-- 25 of 44 accounts (57%) had NO username at all.
--
-- ROOT CAUSE, not a backfill gap: migration 0168 was a ONE-TIME
-- `UPDATE profiles SET username = ...`, and handle_new_user() inserts only
-- (id, email). So every account created after 0168 ran has been usernameless,
-- and the count grows with every signup. publicHandle()'s own docblock claims
-- "Every account is backfilled with a handle (migration 0168)" — true the day
-- it ran, decaying ever since.
--
-- Nothing leaked: publicHandle() degrades to "Advocate from OK" → "Member".
-- But 25 users rendering as an indistinguishable "Member" makes the online-user
-- panel and the DM picker unusable, and it is not the anonymity we promised —
-- it is the absence of an identity.
--
-- FIX, three layers so this cannot regress:
--   1. a BEFORE INSERT trigger on profiles — covers the signup path AND any
--      other insert path (admin seed, import, future code). Fixing only
--      handle_new_user would leave every other door open.
--   2. backfill the existing 25.
--   3. `username_chosen` so the app can tell an auto-assigned placeholder from
--      a handle the user actually picked, and prompt for the former. Without
--      it the app would have to pattern-match `member_[0-9a-f]{10}`, which
--      would also (wrongly) nag anyone who deliberately chose that shape.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_ensure_profile_username ON public.profiles;
--   DROP FUNCTION IF EXISTS public.ensure_profile_username();
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS username_chosen;
--   (the backfilled usernames are left in place — removing them would
--    re-open the anonymity gap this migration closed)

-- ── 1. Did the user pick this handle, or did we? ────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username_chosen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.username_chosen IS
  'true = the user deliberately chose this handle. false = auto-assigned placeholder; the app prompts them to pick one. Set true by the username-change path only.';

-- Anyone who already has a non-placeholder handle chose it deliberately —
-- do not nag them.
UPDATE public.profiles
SET username_chosen = true
WHERE username IS NOT NULL
  AND length(trim(username)) > 0
  AND username !~ '^member_[0-9a-f]{10}$'
  AND username_chosen = false;

-- ── 2. The guarantee ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_profile_username()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.username IS NULL OR length(trim(NEW.username)) = 0 THEN
    -- Derived from the row's own uuid, so it is unique without a lookup and
    -- without a retry loop. Matches 0168's shape so existing placeholders and
    -- new ones are indistinguishable to the app.
    NEW.username := 'member_' || substr(replace(NEW.id::text, '-', ''), 1, 10);
    NEW.username_chosen := false;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_profile_username IS
  '0247: guarantees every profile has a username. Runs BEFORE INSERT so it covers signup and every other insert path, not just handle_new_user().';

DROP TRIGGER IF EXISTS trg_ensure_profile_username ON public.profiles;
CREATE TRIGGER trg_ensure_profile_username
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_profile_username();

-- ── 3. Close the existing gap ───────────────────────────────────────────────
UPDATE public.profiles
SET username = 'member_' || substr(replace(id::text, '-', ''), 1, 10),
    username_chosen = false
WHERE username IS NULL
   OR length(trim(username)) = 0;

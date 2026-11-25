-- ============================================================
-- 0334: a member's own API write can't change the fields the server keeps
-- ============================================================
-- Found 2026-11-25. `authenticated` holds UPDATE on every profiles column, and
-- the self-update policy lets a member write their own row. The guard
-- (guard_profiles_self_privilege, 0212 → 0286) covers is_owner, the role
-- flags, the lock, vendor approval and the avatar. It does NOT cover the
-- fields the site trusts as earned or as moderation state. So any signed-in
-- member could, with one request from the browser console:
--
--   * forum_post_count, created_at → skip new-member review of first forum
--     posts and the new-account limits (src/modules/forum/actions.ts, chat);
--   * chat_muted_until             → lift their own Lounge mute;
--   * intel_approved_count, intel_rejected_count, intel_last_approved_at
--                                  → look like a trusted tipster
--                                    (src/modules/alerts/actions.ts);
--   * power_user_at                → wear the power-user checkmark;
--   * points_total, action_streak_days, longest_streak_days,
--     last_action_date             → fake points and streaks.
--
-- Every legitimate writer of these is a SECURITY DEFINER function (exam,
-- lesson points, award_points_from_action, bump_action_streak,
-- bump_forum_post_count, update_intel_tier_on_moderation) or the service role
-- (the Lounge mute, scripts). Inside a definer function current_user is the
-- function's owner, and the service role has no auth.uid(). So this guard is
-- SECURITY INVOKER and checks current_user: only a member's own DIRECT write
-- is refused. That is also why it can't live inside the existing guard, which
-- is SECURITY DEFINER and so always sees its own owner as current_user.
--
-- Left writable on purpose:
--   * discord_*  : the Discord OAuth callback writes them with the member's own
--                  session. Moving it to the service role needs a site build.
--   * email_provider_tier : the member's own declaration of their mail plan,
--                  set from the send page.
--   * last_seen_at, lounge_seen_at : presence and unread state, not trust.
-- tests/profiles-server-kept-guard.test.ts scans every migration for a
-- definer function that writes profiles, so a new server-kept column fails CI
-- until it joins this list or that test's reviewed allowlist.
--
-- Rollback:
--   drop trigger if exists trg_profiles_guard_server_kept on public.profiles;
--   drop function if exists public.guard_profiles_server_kept();

create or replace function public.guard_profiles_server_kept()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- A definer function runs as its owner; the service role and cron have no
  -- auth.uid(). Only a member writing their own row through the API is checked.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null or auth.uid() is distinct from old.id then
    return new;
  end if;

  if new.power_user_at          is distinct from old.power_user_at
  or new.points_total           is distinct from old.points_total
  or new.action_streak_days     is distinct from old.action_streak_days
  or new.longest_streak_days    is distinct from old.longest_streak_days
  or new.last_action_date       is distinct from old.last_action_date
  or new.forum_post_count       is distinct from old.forum_post_count
  or new.intel_approved_count   is distinct from old.intel_approved_count
  or new.intel_rejected_count   is distinct from old.intel_rejected_count
  or new.intel_last_approved_at is distinct from old.intel_last_approved_at
  or new.chat_muted_until       is distinct from old.chat_muted_until
  or new.created_at             is distinct from old.created_at
  or new.referrer_id            is distinct from old.referrer_id
  then
    raise exception 'that profile field is kept by the server'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function public.guard_profiles_server_kept() from public, anon, authenticated;

drop trigger if exists trg_profiles_guard_server_kept on public.profiles;
create trigger trg_profiles_guard_server_kept
  before update on public.profiles
  for each row execute function public.guard_profiles_server_kept();

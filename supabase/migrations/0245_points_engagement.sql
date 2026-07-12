-- ============================================================
-- 0245 — Engagement points (extends the 0236 achievement-points spine)
-- ============================================================
-- Owner ask (2026-07-11): award points for signing up, using features, and
-- interacting with others / passing information along — not just advocacy
-- actions. Builds directly on 0236: same `achievement_points` ledger, same
-- idempotency key UNIQUE(user_id, kind, ref_id) NULLS NOT DISTINCT, same
-- denormalized `profiles.points_total` cache. New `kind`s only (the column is
-- free text — no CHECK to widen). The dashboard ScoreboardWidget reads
-- points_total, so these flow into the existing scoreboard with no UI change.
--
-- FORGE-PROOF: every award is written by a SECURITY DEFINER trigger on a
-- server-controlled table (never a client-callable award RPC that takes a
-- userId), and is idempotent so it can't be padded past its ceiling:
--   signup       20  once per user            ref = user_id
--   forum_thread  6  once per thread          ref = thread id
--   forum_reply   3  once per post            ref = post id
--   chat_daily    2  once per user PER DAY     ref = user_id:YYYY-MM-DD
-- Chat is deliberately a once-a-day participation nudge (ref bucketed by date)
-- so an active chatter can't farm it message-by-message.
--
-- SIGNUP-PATH SAFETY: migration 0140 hardened handle_new_user() because a
-- throwing trigger on the auth.users → profiles chain aborts the whole signup.
-- Every function below therefore wraps its body in EXCEPTION WHEN OTHERS and
-- swallows — a points bug can NEVER roll back the user's real action (the
-- signup, forum post, or chat message). This is why we don't reuse the bare
-- 0236 award function (which is fine on campaign_actions but unguarded).
--
-- Points remain COSMETIC (a personal scoreboard). The public power-user
-- checkmark stays course-exam-gated (0241), never points-gated — so none of
-- this grants real privilege, matching the owner's anti-cheese intent and the
-- 0236 trust note. Before points ever gate a competitive leaderboard, the
-- campaign_actions write path must first move behind scope-revalidating RPCs
-- (tracked in private/ACHIEVEMENTS_AND_ACADEMY_PLAN.md).
--
-- Rollback:
--   drop trigger if exists trg_award_points_signup on public.profiles;
--   drop trigger if exists trg_award_points_forum_thread on public.forum_threads;
--   drop trigger if exists trg_award_points_forum_reply on public.forum_posts;
--   drop trigger if exists trg_award_points_chat_daily on public.chat_messages;
--   drop function if exists public.award_points_signup();
--   drop function if exists public.award_points_forum_thread();
--   drop function if exists public.award_points_forum_reply();
--   drop function if exists public.award_points_chat_daily();
--   (achievement_points rows with these kinds may be left or deleted.)

-- Shared helper: award `pts` of `kind` to `uid` keyed on `ref`, bumping the
-- cache only on a real insert. Kept as a function so each trigger is a 3-liner
-- and the exact-once accounting lives in one place. SECURITY DEFINER: writes
-- the ledger (which has no self-insert policy) on the user's behalf.
create or replace function public.award_points(uid uuid, p_kind text, pts int, p_ref_type text, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted int;
begin
  if uid is null or p_ref is null then
    return;
  end if;
  insert into public.achievement_points(user_id, kind, points, ref_type, ref_id)
  values (uid, p_kind, pts, p_ref_type, p_ref)
  on conflict (user_id, kind, ref_id) do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.profiles set points_total = points_total + pts where id = uid;
  end if;
end;
$$;

-- Only the trigger functions call award_points; do not expose it to clients.
revoke all on function public.award_points(uuid, text, int, text, text) from public, anon, authenticated;

-- 1) Signup — one-time, as the profile row is created by handle_new_user().
create or replace function public.award_points_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_points(new.id, 'signup', 20, 'user', new.id::text);
  return new;
exception when others then
  -- NEVER break the (0140-hardened) signup chain over a points bug.
  return new;
end;
$$;

drop trigger if exists trg_award_points_signup on public.profiles;
create trigger trg_award_points_signup
  after insert on public.profiles
  for each row execute function public.award_points_signup();

-- 2) Forum thread — one-time per thread.
create or replace function public.award_points_forum_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_points(new.author_id, 'forum_thread', 6, 'forum_thread', new.id::text);
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_award_points_forum_thread on public.forum_threads;
create trigger trg_award_points_forum_thread
  after insert on public.forum_threads
  for each row execute function public.award_points_forum_thread();

-- 3) Forum reply — one-time per post (skip rows that arrive already soft-deleted).
create or replace function public.award_points_forum_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is null then
    perform public.award_points(new.author_id, 'forum_reply', 3, 'forum_post', new.id::text);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_award_points_forum_reply on public.forum_posts;
create trigger trg_award_points_forum_reply
  after insert on public.forum_posts
  for each row execute function public.award_points_forum_reply();

-- 4) Chat — once per user per (UTC) day, so participation is nudged without
--    per-message farming. ref bucketed by date makes it idempotent per day.
create or replace function public.award_points_chat_daily()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_points(
    new.user_id, 'chat_daily', 2, 'day',
    new.user_id::text || ':' || (current_date)::text
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists trg_award_points_chat_daily on public.chat_messages;
create trigger trg_award_points_chat_daily
  after insert on public.chat_messages
  for each row execute function public.award_points_chat_daily();

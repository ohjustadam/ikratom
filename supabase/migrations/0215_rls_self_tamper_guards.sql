-- ============================================================
-- 0215 — Block self-moderation tampering on forum + call_sessions
-- ============================================================
-- Pen-test (HIGH): forum_threads/forum_posts author UPDATE policies
-- (0010_forum.sql) and call_sessions self-update (0113) use `using(...)` with NO
-- `with check`, and Postgres RLS can't restrict WHICH columns are written. So an
-- author, via a direct PostgREST write with their own JWT (bypassing the
-- server-action role checks), can:
--   • flip their own pending/auto_flagged forum post/thread to
--     moderation_status='approved' (self-approve past moderation),
--   • set pinned=true / locked on their own thread,
--   • flip their own call_session to moderation_status='approved' and publish
--     unreviewed "intel" onto the public /calls board.
--
-- Mirroring 0212's guard pattern, BEFORE UPDATE triggers enforce the invariant
-- in the DB. They EXEMPT service-role (auth.uid() null — cron/server) and
-- moderators (is_campaign_creator = admin OR advocate-leader, the role the forum
-- moderation policies already trust), so legitimate moderation still works; only
-- a plain author editing their OWN row is blocked from touching the
-- moderation/privilege columns. Denormalized counts (post_count/upvote_count)
-- are intentionally NOT guarded — they're maintained by other triggers running
-- in the user's auth context, and inflating one's own thread counters is a
-- negligible vanity issue, not worth breaking those triggers.
--
-- Rollback: drop the three triggers + functions below.

-- ── forum_threads ───────────────────────────────────────────
create or replace function public.guard_forum_thread_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_campaign_creator(auth.uid()) then
    return new; -- service-role / moderator (admin or leader) — allowed
  end if;
  if new.moderation_status is distinct from old.moderation_status
     or new.flag_reason       is distinct from old.flag_reason
     or new.pinned            is distinct from old.pinned
     or new.locked            is distinct from old.locked
  then
    raise exception 'not authorized to change moderation/pin/lock on this thread';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_forum_thread_update on public.forum_threads;
create trigger trg_guard_forum_thread_update
  before update on public.forum_threads
  for each row execute function public.guard_forum_thread_update();

-- ── forum_posts ─────────────────────────────────────────────
create or replace function public.guard_forum_post_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_campaign_creator(auth.uid()) then
    return new;
  end if;
  if new.moderation_status is distinct from old.moderation_status
     or new.flag_reason     is distinct from old.flag_reason
  then
    raise exception 'not authorized to change moderation status on this post';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_forum_post_update on public.forum_posts;
create trigger trg_guard_forum_post_update
  before update on public.forum_posts
  for each row execute function public.guard_forum_post_update();

-- ── call_sessions ───────────────────────────────────────────
-- A user may submit their own call for review (private → pending_review) but may
-- never self-APPROVE/REJECT it onto the public /calls board — that's moderator-only.
create or replace function public.guard_call_session_moderation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_campaign_creator(auth.uid()) then
    return new;
  end if;
  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status in ('approved', 'rejected')
  then
    raise exception 'not authorized to approve/reject your own call session';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_call_session_moderation on public.call_sessions;
create trigger trg_guard_call_session_moderation
  before update on public.call_sessions
  for each row execute function public.guard_call_session_moderation();

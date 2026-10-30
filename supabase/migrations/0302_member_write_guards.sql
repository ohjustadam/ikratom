-- 0302_member_write_guards.sql — security sweep, 2026-10-30.
--
-- Members (and, for campaign_shares, anyone holding the public key) can write
-- these tables straight through the API, not only through the site's server
-- actions. Row-level security checked WHO wrote a row, never WHAT it said, so
-- a direct API call could set columns the server owns. Each case below was
-- proven as an ordinary member inside a rolled-back transaction.
--
-- 1. campaign_shares: INSERT was open to everyone (check true). The public key
--    could write unlimited rows past recordShare()'s rate limit (enough to fill
--    the free database) and stamp any member's id. recordShare() now writes
--    with the service role, so the API path closes.
--    APPLY AFTER the deploy that ships that recordShare change.
-- 2. forum_threads / forum_posts: a direct insert could arrive pinned, locked,
--    or with any upvote/helpful/post count.
-- 3. kratom_stories: a member could insert a story as already approved, and
--    re-approve their own rejected story, skipping review.
-- 4. coalition_members "members: admin insert": a group owner could add any
--    member, even as an owner, without asking them. Joining goes through
--    decide_coalition_join_request() and invites; the direct path now only
--    admits someone who asked (a join request) and only as a plain member.
--
-- Service role and moderators pass every guard, matching the existing
-- guard_forum_*_update triggers (auth.uid() null or is_campaign_creator).
--
-- Rollback:
--   create policy shares_public_insert on public.campaign_shares for insert to public with check (true);
--   grant insert on public.campaign_shares to anon, authenticated;
--   drop trigger trg_guard_forum_thread_insert on public.forum_threads;
--   drop trigger trg_guard_forum_post_insert on public.forum_posts;
--   drop trigger trg_guard_story_insert on public.kratom_stories;
--   drop trigger trg_guard_story_update on public.kratom_stories;
--   drop function public.guard_member_content_insert(); drop function public.guard_story_update();
--   drop policy "members: admin insert" on public.coalition_members;
--   create policy "members: admin insert" on public.coalition_members for insert to public
--     with check (auth.uid() is not null and public.is_coalition_admin(coalition_id));

-- 1 ─────────────────────────────────────────────────────────────────────────
drop policy if exists shares_public_insert on public.campaign_shares;
revoke insert on public.campaign_shares from anon, authenticated;

-- 2 + 3 (insert) ────────────────────────────────────────────────────────────
create or replace function public.guard_member_content_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_campaign_creator(auth.uid()) then
    return new; -- service role / moderator
  end if;
  if tg_table_name = 'forum_threads' then
    new.pinned := false;
    new.locked := false;
    new.upvote_count := 0;
    new.helpful_count := 0;
    new.post_count := 0;
  elsif tg_table_name = 'forum_posts' then
    new.upvote_count := 0;
    new.helpful_count := 0;
    new.deleted_at := null;
  elsif tg_table_name = 'kratom_stories' then
    new.moderation_status := 'pending';
    new.moderation_note := null;
    new.approved_at := null;
    new.approved_by := null;
    new.upvote_count := 0;
    new.deleted_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_forum_thread_insert on public.forum_threads;
create trigger trg_guard_forum_thread_insert before insert on public.forum_threads
  for each row execute function public.guard_member_content_insert();
drop trigger if exists trg_guard_forum_post_insert on public.forum_posts;
create trigger trg_guard_forum_post_insert before insert on public.forum_posts
  for each row execute function public.guard_member_content_insert();
drop trigger if exists trg_guard_story_insert on public.kratom_stories;
create trigger trg_guard_story_insert before insert on public.kratom_stories
  for each row execute function public.guard_member_content_insert();

-- 3 (update) ────────────────────────────────────────────────────────────────
create or replace function public.guard_story_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin(auth.uid()) or public.has_permission(auth.uid(), 'moderate_stories') then
    return new;
  end if;
  if new.moderation_status is distinct from old.moderation_status
     or new.moderation_note is distinct from old.moderation_note
     or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by
     or new.upvote_count is distinct from old.upvote_count then
    raise exception 'not authorized to change moderation on this story';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_story_update on public.kratom_stories;
create trigger trg_guard_story_update before update on public.kratom_stories
  for each row execute function public.guard_story_update();

revoke execute on function public.guard_member_content_insert() from public, anon, authenticated;
revoke execute on function public.guard_story_update() from public, anon, authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
drop policy if exists "members: admin insert" on public.coalition_members;
create policy "members: admin insert" on public.coalition_members for insert to authenticated
  with check (
    auth.uid() is not null
    and public.is_coalition_admin(coalition_id)
    and role = 'member'
    and exists (
      select 1 from public.coalition_join_requests r
      where r.coalition_id = coalition_members.coalition_id and r.user_id = coalition_members.user_id
    )
  );

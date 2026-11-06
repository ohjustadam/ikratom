-- 0317_forum_edits.sql
--
-- Members can edit and delete their own forum posts (PJ, 2026-11-06). The owner
-- asked that every role be accounted for and that spam can't ride along.
--
-- Until now an author could change a post's words straight through the API, with
-- no screening and no record, so a post could pass review and then be rewritten
-- into spam. From here on the words change only on the server, in
-- src/modules/forum/edit-actions.ts, which checks who is asking, screens the new
-- text and keeps the old text here.
--
-- forum_edits is the record: every edit and delete, with what the words were.
-- Moderators read it; nobody writes it but the server.
--
-- The hard-delete policy goes too. It let an author wipe a thread and every
-- reply under it, and removed the evidence with it.
--
-- Rollback:
--   drop table if exists public.forum_edits;
--   alter table public.forum_posts drop column if exists edited_by_moderator;
--   alter table public.forum_threads drop column if exists edited_by_moderator;
--   re-run guard_forum_post_update and guard_forum_thread_update from 0022;
--   create policy "forum_threads_author_delete" on public.forum_threads for delete
--     using (auth.uid() = author_id or public.is_campaign_creator(auth.uid()));

create table if not exists public.forum_edits (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'thread')),
  target_id uuid not null,
  thread_id uuid not null,
  action text not null default 'edit' check (action in ('edit', 'delete')),
  editor_id uuid references auth.users(id) on delete set null,
  editor_role text not null check (editor_role in ('author', 'moderator')),
  previous_title text,
  previous_body text,
  created_at timestamptz not null default now()
);

create index if not exists forum_edits_target_idx
  on public.forum_edits (target_type, target_id, created_at desc);
create index if not exists forum_edits_recent_idx
  on public.forum_edits (created_at desc);

alter table public.forum_edits enable row level security;

drop policy if exists "forum_edits_moderator_read" on public.forum_edits;
create policy "forum_edits_moderator_read" on public.forum_edits
  for select to authenticated
  using (public.is_admin(auth.uid()) or public.has_permission(auth.uid(), 'moderate_forum'));

revoke all on public.forum_edits from anon, authenticated;
grant select on public.forum_edits to authenticated;
grant all on public.forum_edits to service_role;

alter table public.forum_posts
  add column if not exists edited_by_moderator boolean not null default false;
alter table public.forum_threads
  add column if not exists edited_by_moderator boolean not null default false;

create or replace function public.guard_forum_post_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new; -- service role: the server action already checked the caller
  end if;
  -- Nobody changes these through the API, moderators included. The server
  -- screens the words and keeps the old text.
  if new.body is distinct from old.body
     or new.edited_at is distinct from old.edited_at
     or new.edited_by_moderator is distinct from old.edited_by_moderator
     or new.deleted_at is distinct from old.deleted_at
  then
    raise exception 'forum posts are edited through the site';
  end if;
  if public.is_campaign_creator(auth.uid()) then
    return new;
  end if;
  if new.moderation_status is distinct from old.moderation_status
     or new.flag_reason     is distinct from old.flag_reason
  then
    raise exception 'not authorized to change moderation status on this post';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_forum_thread_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    return new; -- service role: the server action already checked the caller
  end if;
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.edited_at is distinct from old.edited_at
     or new.edited_by_moderator is distinct from old.edited_by_moderator
  then
    raise exception 'forum threads are edited through the site';
  end if;
  if public.is_campaign_creator(auth.uid()) then
    return new; -- moderator (admin or leader)
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
$function$;

drop policy if exists "forum_threads_author_delete" on public.forum_threads;

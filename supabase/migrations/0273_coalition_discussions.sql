-- 0273_coalition_discussions.sql
--
-- A private discussion board for each coalition (owner ask 2026-10-21, from
-- a member who created "Rein In Chaos" and found the page was a dead end:
-- "Shouldn't there be a discussion page where I can coordinate with other
-- members?"). Coalitions had a roster, invite links and aggregate stats, but
-- no way for members to talk.
--
-- Two flat tables: threads, and the replies under them. Members of the
-- coalition read and write; nobody else sees a word (site admins can read for
-- moderation). Authors and the coalition's owner/admins can soft-delete
-- (deleted_at), so a removed post leaves no gap in the reply count history.
-- Authors are rendered by @username only (get_public_profiles), never by
-- real name: the platform's public-anonymity rule applies inside groups too.
--
-- Rollback: drop table public.coalition_posts; drop table public.coalition_threads;
--           drop function public.coalition_posts_bump_thread();

create table if not exists public.coalition_threads (
  id            uuid primary key default gen_random_uuid(),
  coalition_id  uuid not null references public.coalitions(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (char_length(title) between 3 and 140),
  body          text not null check (char_length(body) between 1 and 5000),
  reply_count   integer not null default 0,
  last_post_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists ix_coalition_threads_board
  on public.coalition_threads (coalition_id, last_post_at desc) where deleted_at is null;

create table if not exists public.coalition_posts (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.coalition_threads(id) on delete cascade,
  coalition_id  uuid not null references public.coalitions(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 5000),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists ix_coalition_posts_thread
  on public.coalition_posts (thread_id, created_at) where deleted_at is null;

alter table public.coalition_threads enable row level security;
alter table public.coalition_posts enable row level security;

-- Threads ---------------------------------------------------------------
create policy "coalition_threads: members read" on public.coalition_threads
  for select to authenticated
  using (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

create policy "coalition_threads: members post" on public.coalition_threads
  for insert to authenticated
  with check (author_id = auth.uid() and public.is_coalition_member(coalition_id));

create policy "coalition_threads: author or group admin edits" on public.coalition_threads
  for update to authenticated
  using (author_id = auth.uid() or public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()))
  with check (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

-- Replies ---------------------------------------------------------------
create policy "coalition_posts: members read" on public.coalition_posts
  for select to authenticated
  using (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

-- A reply must land in a live thread of the SAME coalition, so a member of
-- group A can't write into group B's thread by naming its id.
create policy "coalition_posts: members reply" on public.coalition_posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.is_coalition_member(coalition_id)
    and exists (
      select 1 from public.coalition_threads t
      where t.id = thread_id and t.coalition_id = coalition_posts.coalition_id and t.deleted_at is null
    )
  );

create policy "coalition_posts: author or group admin edits" on public.coalition_posts
  for update to authenticated
  using (author_id = auth.uid() or public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()))
  with check (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

-- Keep the board's sort and counts current. SECURITY DEFINER because a member
-- replying is not the thread's author and has no UPDATE right on it.
create or replace function public.coalition_posts_bump_thread()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.coalition_threads
     set reply_count = reply_count + 1,
         last_post_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_coalition_posts_bump_thread on public.coalition_posts;
create trigger trg_coalition_posts_bump_thread
  after insert on public.coalition_posts
  for each row execute function public.coalition_posts_bump_thread();

revoke execute on function public.coalition_posts_bump_thread() from public, anon, authenticated;

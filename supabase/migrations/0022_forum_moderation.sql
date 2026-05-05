-- ============================================================
-- 0022 — Forum moderation system
-- ============================================================
-- Adds:
--   - moderation_status / flag_reason / auto_flag_signals columns on
--     forum_posts and forum_threads
--   - profiles.forum_post_count denormalized for "first 3 posts" gating
--   - forum_post_reports table for user-submitted reports
--   - RLS that hides non-approved posts/threads from non-mods (except author)
--   - Trigger to maintain forum_post_count
--   - Backfill: mark all existing rows as approved, populate post counts
-- ============================================================

-- ── 1. moderation_status on forum_posts + forum_threads ─────
-- Statuses:
--   'approved'      visible to everyone (default)
--   'pending'       new user, awaits moderator approval
--   'auto_flagged'  detector matched URL/contact info — review queue
--   'user_flagged'  another user reported it — review queue
--   'removed'       moderator explicitly removed (distinct from
--                   deleted_at which is the author's own self-delete)
alter table public.forum_posts
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('approved','pending','auto_flagged','user_flagged','removed')),
  add column if not exists flag_reason text,
  add column if not exists auto_flag_signals jsonb;

alter table public.forum_threads
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('approved','pending','auto_flagged','user_flagged','removed')),
  add column if not exists flag_reason text,
  add column if not exists auto_flag_signals jsonb;

create index if not exists forum_posts_moderation_idx
  on public.forum_posts (moderation_status, created_at desc);
create index if not exists forum_threads_moderation_idx
  on public.forum_threads (moderation_status, created_at desc);

-- ── 2. profiles.forum_post_count ────────────────────────────
-- Approved post count, for "new user" gating and trust tracking.
alter table public.profiles
  add column if not exists forum_post_count integer not null default 0;

-- ── 3. forum_post_reports table ─────────────────────────────
create table if not exists public.forum_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.forum_posts(id) on delete cascade,
  thread_id uuid references public.forum_threads(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  reason_category text check (reason_category in (
    'spam','commercial','harassment','off_topic','misinformation','other'
  )),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text,
  -- exactly one of post_id / thread_id must be set
  check (
    (post_id is not null and thread_id is null) or
    (post_id is null and thread_id is not null)
  )
);

create index if not exists forum_post_reports_post_idx
  on public.forum_post_reports (post_id, created_at desc);
create index if not exists forum_post_reports_thread_idx
  on public.forum_post_reports (thread_id, created_at desc);
create index if not exists forum_post_reports_unresolved_idx
  on public.forum_post_reports (resolved_at) where resolved_at is null;

alter table public.forum_post_reports enable row level security;

-- Reporters: insert their own reports; read their own
drop policy if exists "reports_insert_own" on public.forum_post_reports;
create policy "reports_insert_own" on public.forum_post_reports
  for insert with check (auth.uid() = reporter_id);

drop policy if exists "reports_self_read" on public.forum_post_reports;
create policy "reports_self_read" on public.forum_post_reports
  for select using (auth.uid() = reporter_id);

-- Admins / leaders read + update all reports
drop policy if exists "reports_admin_all" on public.forum_post_reports;
create policy "reports_admin_all" on public.forum_post_reports
  for all using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── 4. Tighten RLS so non-approved content is hidden ────────
-- Replace permissive forum_posts public read with status-aware version.
drop policy if exists "forum_posts_public_read" on public.forum_posts;
create policy "forum_posts_public_read" on public.forum_posts
  for select using (
    moderation_status = 'approved'
    or auth.uid() = author_id           -- authors see their own pending/flagged
    or public.is_admin(auth.uid())      -- admins see everything
  );

drop policy if exists "forum_threads_public_read" on public.forum_threads;
create policy "forum_threads_public_read" on public.forum_threads
  for select using (
    moderation_status = 'approved'
    or auth.uid() = author_id
    or public.is_admin(auth.uid())
  );

-- ── 5. Trigger: maintain profiles.forum_post_count ──────────
-- Bump count when a post transitions to 'approved'; decrement when it
-- leaves 'approved'.
create or replace function public.bump_forum_post_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.moderation_status = 'approved' and new.author_id is not null then
      update public.profiles set forum_post_count = forum_post_count + 1 where id = new.author_id;
    end if;
    return new;
  elsif (tg_op = 'UPDATE') then
    if old.moderation_status is distinct from new.moderation_status then
      if old.moderation_status = 'approved' and new.moderation_status <> 'approved' and new.author_id is not null then
        update public.profiles set forum_post_count = greatest(0, forum_post_count - 1) where id = new.author_id;
      elsif old.moderation_status <> 'approved' and new.moderation_status = 'approved' and new.author_id is not null then
        update public.profiles set forum_post_count = forum_post_count + 1 where id = new.author_id;
      end if;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.moderation_status = 'approved' and old.author_id is not null then
      update public.profiles set forum_post_count = greatest(0, forum_post_count - 1) where id = old.author_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists forum_posts_count_trigger on public.forum_posts;
create trigger forum_posts_count_trigger
  after insert or update of moderation_status or delete on public.forum_posts
  for each row execute function public.bump_forum_post_count();

-- ── 6. Backfill existing rows ───────────────────────────────
-- All existing posts predate the moderation system → grandfather them as approved.
update public.forum_posts set moderation_status = 'approved' where moderation_status is null;
update public.forum_threads set moderation_status = 'approved' where moderation_status is null;

-- Recompute forum_post_count from scratch (idempotent).
update public.profiles set forum_post_count = sub.cnt
from (
  select author_id, count(*)::int as cnt
  from public.forum_posts
  where moderation_status = 'approved' and author_id is not null
  group by author_id
) sub
where profiles.id = sub.author_id;

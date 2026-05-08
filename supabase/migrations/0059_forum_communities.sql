-- ============================================================
-- 0059_forum_communities
--
-- Admin-managed topical communities that sit alongside the auto-
-- derived state forums. Examples: "Veterans", "Shop owners",
-- "Caregivers", "Researchers". Each is a slug-addressable namespace
-- a thread can be filed under.
--
-- Why a separate table instead of more enum values on forum_threads.tag:
--   - Tag is a closed enum (general/legislation/news/event/meetup/market)
--     and stays that way — those describe the KIND of thread.
--   - Communities are admin-curated, expandable, and have prose
--     descriptions / icons / sort order. They describe the AUDIENCE.
--   - Thread can have both: e.g. "(market) thread in (Shop owners)
--     community."
--
-- forum_threads.community_id is nullable — null means "no community,
-- just a state thread." The /forum/c/[slug] page filters by
-- community_id; the existing /forum/[state] page is unchanged.
-- ============================================================

create table if not exists public.forum_communities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  icon text,                      -- single emoji or short string
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_communities_slug_format
    check (slug ~ '^[a-z0-9-]{2,40}$'),
  constraint forum_communities_name_len
    check (char_length(name) between 2 and 60)
);

create index if not exists ix_forum_communities_active
  on public.forum_communities (is_active, sort_order);

alter table public.forum_threads
  add column if not exists community_id uuid
    references public.forum_communities(id) on delete set null;

create index if not exists ix_forum_threads_community
  on public.forum_threads (community_id, last_activity_at desc)
  where community_id is not null;

-- RLS — public reads active communities; admins do everything.
alter table public.forum_communities enable row level security;

drop policy if exists forum_communities_read_active on public.forum_communities;
create policy forum_communities_read_active
  on public.forum_communities
  for select
  to public
  using (is_active = true);

drop policy if exists forum_communities_admin_all on public.forum_communities;
create policy forum_communities_admin_all
  on public.forum_communities
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- updated_at maintenance.
create or replace function public.forum_communities_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_forum_communities_updated_at on public.forum_communities;
create trigger trg_forum_communities_updated_at
  before update on public.forum_communities
  for each row execute function public.forum_communities_touch_updated_at();

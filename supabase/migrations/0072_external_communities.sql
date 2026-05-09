-- ============================================================
-- 0072_external_communities
--
-- DB-backed CRUD for the public /communities page (Facebook /
-- Reddit / Discord / Podcasts / etc. — third-party communities we
-- recommend, NOT the iKratom internal forum communities at
-- /admin/communities → forum_communities).
--
-- Why a table: prior version was a hardcoded const array in
-- src/app/communities/page.tsx — every edit was a code commit. The
-- list moves slowly but admins should be able to retire dead
-- Discord links / add new podcasts without our help.
--
-- Naming: "external_communities" to keep it distinct from
-- forum_communities. Different feature, different audience, no
-- shared UI.
-- ============================================================

create table if not exists public.external_communities (
  id uuid primary key default gen_random_uuid(),
  category text not null,                 -- 'facebook' | 'reddit' | 'discord' | 'podcast' | 'other' (extensible)
  name text not null,
  href text not null,                     -- the public URL we link to
  description text,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_communities_category_chk
    check (category in ('facebook','reddit','discord','podcast','telegram','youtube','other')),
  constraint external_communities_name_len
    check (char_length(name) between 2 and 100),
  constraint external_communities_href_len
    check (char_length(href) between 8 and 500),
  constraint external_communities_desc_len
    check (description is null or char_length(description) <= 500)
);

create index if not exists ix_external_communities_active
  on public.external_communities (is_active, category, sort_order);

-- ----------------------------------------
-- updated_at maintenance
-- ----------------------------------------
create or replace function public.touch_external_communities_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_external_communities_touch on public.external_communities;
create trigger trg_external_communities_touch
  before update on public.external_communities
  for each row execute function public.touch_external_communities_updated_at();

-- ----------------------------------------
-- RLS — public reads active rows; admins do everything.
-- ----------------------------------------
alter table public.external_communities enable row level security;

drop policy if exists external_communities_read_active on public.external_communities;
create policy external_communities_read_active
  on public.external_communities
  for select
  to public
  using (is_active = true);

drop policy if exists external_communities_admin_all on public.external_communities;
create policy external_communities_admin_all
  on public.external_communities
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ----------------------------------------
-- Seed from the hardcoded list that previously lived in
-- src/app/communities/page.tsx. Idempotent on (category, href).
-- ----------------------------------------
insert into public.external_communities (category, name, href, description, sort_order) values
  ('facebook', 'American Kratom Association', 'https://www.facebook.com/AmericanKratomAssociation/', 'Largest national advocacy org. Action alerts + state-by-state updates.', 10),
  ('facebook', 'Global Kratom Coalition', 'https://www.facebook.com/globalkratomcoalition/', 'Industry-aligned advocacy + regulatory news.', 20),
  ('facebook', 'Kratom United (FB Group)', 'https://www.facebook.com/groups/kratomunited/', 'Open community group. Personal stories + advocacy chatter.', 30),
  ('facebook', 'Kratom Science (FB)', 'https://www.facebook.com/kratomscienceofficial/', 'Research-focused content from the Kratom Science Podcast team.', 40),
  ('reddit',   'r/kratom', 'https://reddit.com/r/kratom', 'Largest English-language kratom subreddit. Strain talk + general discussion.', 10),
  ('reddit',   'r/quittingkratom', 'https://reddit.com/r/quittingkratom', 'Honest space about cessation — important context for advocacy.', 20),
  ('reddit',   'r/KratomKentucky', 'https://reddit.com/r/KratomKentucky', 'State-level subreddit; legislative updates.', 30),
  ('discord',  'Kratom Science Discord', 'https://discord.gg/kratomscience', 'Most-active English kratom Discord. Research + community.', 10),
  ('podcast',  'Kratom Science Podcast', 'https://kratomscience.com/', 'Long-form interviews with researchers, advocates, legislators.', 10),
  ('podcast',  'Leaf of Life Wellness', 'https://www.leafoflifewellness.com/', 'Stories from the kratom community + advocacy interviews.', 20)
on conflict do nothing;

comment on table public.external_communities is
  'Third-party communities we recommend on the public /communities page (Facebook groups, subreddits, Discord servers, podcasts). NOT to be confused with forum_communities (internal iKratom communities). Admin-CRUD via /admin/external-communities.';

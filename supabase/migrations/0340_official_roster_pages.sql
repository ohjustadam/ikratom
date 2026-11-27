-- 0340_official_roster_pages.sql
--
-- Which page is each state chamber's own member list? check-official-rosters.mjs
-- (migration 0339) learns it and remembers it here, so the engine keeps
-- working when a legislature moves its site or starts a new session (Kansas
-- puts the biennium in the URL: /b2025_26/house/representatives/).
--
-- A page is kept only after it VOUCHED for the chamber: it listed nearly every
-- member we expect to stay. Each daily run re-checks the remembered pages
-- first. A page that stops vouching for 14 runs is retired (kept, never
-- deleted), and the weekly discovery run (--discover) crawls the chamber's
-- home page for a new one. found_by says where a page came from: seed (in
-- code), openstates (cited by openstates/people), discovery (crawled).
--
-- Flat, admin-read, service-role writes. Grants explicit (no default grants
-- after 2026-10-30).
--
-- Rollback: drop table public.official_roster_pages;

create table if not exists public.official_roster_pages (
  id              uuid primary key default gen_random_uuid(),
  state           text not null,
  office          text not null,                 -- a legislators.role value
  url             text not null,
  method          text not null default 'GET',
  found_by        text not null check (found_by in ('seed', 'openstates', 'discovery')),
  coverage        numeric(4,3),                  -- share of staying members this page listed, last time it vouched
  last_vouched_on date,
  last_checked_on date,
  misses          integer not null default 0,    -- runs in a row it was tried and did not help
  retired_on      date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint official_roster_pages_one unique (state, office, url, method)
);

alter table public.official_roster_pages enable row level security;

drop policy if exists "admins read official roster pages" on public.official_roster_pages;
create policy "admins read official roster pages" on public.official_roster_pages
  for select to authenticated using (public.is_admin(auth.uid()));

grant select on public.official_roster_pages to authenticated;
grant all on public.official_roster_pages to service_role;

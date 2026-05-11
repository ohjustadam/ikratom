-- ============================================================
-- 0085_bop_scraper
--
-- Phase 2: Board of Pharmacy (BoP) scraper engine.
--
-- State BoPs are the *administrative* path to a kratom ban — they can
-- schedule (effectively criminalize) a substance via rulemaking without
-- a legislative vote. Several states have tried this in the last two
-- years (NC most notably) so the platform needs an early-warning system.
--
-- Schema is intentionally generic — works for BoP, but also for
-- adjacent agencies (medical board, ag dept, etc.) by changing the
-- `kind` column.
--
-- Tables:
--   bop_sources  — one row per state agency surface we scrape.
--                  e.g. "NC Board of Pharmacy — Rule Proposals"
--   bop_findings — what the scraper finds. Each finding is a single
--                  agenda item / rule proposal / news headline that
--                  matched a kratom-related keyword filter. Admin
--                  triages from /admin/bop-monitor.
-- ============================================================

create table if not exists public.bop_sources (
  id uuid primary key default gen_random_uuid(),
  state text not null,                          -- 2-letter code (NC, FL, etc.) or 'FED'
  board_name text not null,                     -- "NC Board of Pharmacy"
  surface text not null,                        -- "Rule proposals", "Meeting agendas"
  kind text not null default 'agenda',          -- 'agenda' | 'rules' | 'news' | 'meeting'
  agenda_url text not null,                     -- URL to fetch
  adapter text not null default 'generic_html', -- adapter module key (lib/bop-adapters/<key>.mjs)
  enabled boolean not null default false,       -- admin flips after verifying URL works
  notes text,                                   -- admin notes ("PDF behind login", etc.)
  last_scraped_at timestamptz,
  last_status text,                             -- 'ok' | 'no_findings' | 'error'
  last_error text,
  last_finding_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state, board_name, surface)
);

create index if not exists ix_bop_sources_enabled
  on public.bop_sources (enabled, last_scraped_at)
  where enabled = true;

create table if not exists public.bop_findings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.bop_sources(id) on delete cascade,
  state text not null,                          -- denorm from source for fast filters
  title text not null,
  snippet text,
  url text,
  meeting_date date,                            -- when admin knows the agenda date
  -- Auto-classified by the keyword filter at scrape time. Admin can
  -- override via /admin/bop-monitor.
  classified_relevance text not null default 'unknown',
  -- 'kratom_direct' | 'kratom_adjacent' | 'unrelated' | 'unknown'
  classified_severity text not null default 'unknown',
  -- 'hostile_proposal' | 'discussion_only' | 'supportive' | 'neutral' | 'unknown'
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_relevance text,                      -- admin's override
  reviewed_severity text,
  alert_emitted_at timestamptz,                 -- when admin promoted to policy_alerts
  alert_id uuid references public.policy_alerts(id) on delete set null,
  raw jsonb,                                    -- whatever the adapter dumped (full HTML snip, etc.)
  found_at timestamptz not null default now(),
  -- Dedupe key: same source + same url + same title = same finding
  dedupe_key text generated always as (
    coalesce(url, '') || '||' || lower(left(title, 200))
  ) stored,
  unique (source_id, dedupe_key)
);

create index if not exists ix_bop_findings_state_found
  on public.bop_findings (state, found_at desc);

create index if not exists ix_bop_findings_pending_review
  on public.bop_findings (found_at desc)
  where reviewed_at is null and classified_relevance <> 'unrelated';

-- RLS — owner/admin only. No public read.
alter table public.bop_sources enable row level security;
alter table public.bop_findings enable row level security;

drop policy if exists bop_sources_admin_read on public.bop_sources;
create policy bop_sources_admin_read on public.bop_sources
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists bop_sources_admin_write on public.bop_sources;
create policy bop_sources_admin_write on public.bop_sources
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists bop_findings_admin_read on public.bop_findings;
create policy bop_findings_admin_read on public.bop_findings
  for select to authenticated using (public.is_admin(auth.uid()));

drop policy if exists bop_findings_admin_write on public.bop_findings;
create policy bop_findings_admin_write on public.bop_findings
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- updated_at trigger
create or replace function public.touch_bop_sources()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_bop_sources_touch on public.bop_sources;
create trigger trg_bop_sources_touch
  before update on public.bop_sources
  for each row execute function public.touch_bop_sources();

-- ------------------------------------------------------------
-- Seed: known active-on-kratom state BoPs. All start as enabled=false
-- so a sync doesn't fire blind. Admin reviews each URL on /admin/bop-
-- monitor and flips enabled when ready.
-- ------------------------------------------------------------
insert into public.bop_sources (state, board_name, surface, kind, agenda_url, adapter, enabled, notes)
values
  ('NC', 'NC Board of Pharmacy', 'Rule Proposals',
   'rules', 'https://www.ncbop.org/pharmacists/rule-amendments-and-public-comment-period/',
   'generic_html', false,
   'NC has historically been the most active state on scheduling kratom via the BoP. High priority once URL verified.'),
  ('FL', 'FL Board of Pharmacy', 'Meeting Agendas',
   'agenda', 'https://floridaspharmacy.gov/meeting-information/',
   'generic_html', false,
   'FL Senate has flirted with kratom legislation; FL BoP follows along.'),
  ('AR', 'AR State Board of Pharmacy', 'Meeting Information',
   'meeting', 'https://www.pharmacyboard.arkansas.gov/board/meeting-information/',
   'generic_html', false,
   'AR has had kratom on its scheduled-substance lists. Monitor for rescheduling proposals.'),
  ('AL', 'AL Board of Pharmacy', 'Meeting Notices',
   'meeting', 'https://www.albop.com/news/',
   'generic_html', false, null),
  ('IN', 'IN Board of Pharmacy', 'Meeting Schedule',
   'meeting', 'https://www.in.gov/pla/professions/indiana-board-of-pharmacy-home/indiana-board-of-pharmacy/meetings-and-minutes/',
   'generic_html', false, null),
  ('IL', 'IL Dept of Financial & Professional Regulation — Pharmacy',
   'Board Meetings',
   'meeting', 'https://idfpr.illinois.gov/profs/pharm.html',
   'generic_html', false, null),
  ('AZ', 'AZ State Board of Pharmacy', 'Public Notices',
   'news', 'https://pharmacy.az.gov/public-notices',
   'generic_html', false, null),
  ('OH', 'OH State Board of Pharmacy', 'News & Rules',
   'rules', 'https://www.pharmacy.ohio.gov/news.aspx',
   'generic_html', false, null)
on conflict (state, board_name, surface) do nothing;

comment on table public.bop_sources is
  'State Board of Pharmacy (and adjacent agency) surfaces the BoP scraper engine should walk. Admin-managed via /admin/bop-monitor.';
comment on table public.bop_findings is
  'Auto-detected agenda items / rule proposals / news that matched a kratom keyword filter. Admin triages and promotes the hostile ones to policy_alerts.';

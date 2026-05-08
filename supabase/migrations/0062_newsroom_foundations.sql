-- ============================================================
-- 0062_newsroom_foundations
--
-- Phase 0 of the newsroom roadmap (docs/ROADMAP-NEWSROOM.md).
-- Schema only — no UI, no scrapers yet. Subsequent PRs build on
-- top of these tables.
--
-- Three new tables + one column add to campaigns:
--
-- 1. policy_alerts — single canonical event store. Every "something
--    happened, someone needs to know" event lives here regardless of
--    source: bill activity, BoP hearings, FDA actions, news drops,
--    advocate-submitted intel.
--
-- 2. bop_boards — 50-state Board of Pharmacy directory. Static
--    contact + meeting-schedule info up front; scraper_config holds
--    per-state instructions for an upcoming generic scraper engine.
--
-- 3. scraper_runs — observability for the cron pipeline. Every
--    scraper logs success/failure here so /admin/intel-health can
--    show "last successful pull from BoP-NJ was 4h ago" and alarm
--    when sources go silent.
--
-- 4. campaigns.mobilization_type — distinguishes constituent-only
--    campaigns (state legislator emails) from solidarity campaigns
--    open to all members (BoP hearings, federal actions). Default
--    is "constituent" to preserve current behavior.
-- ============================================================

-- ----------------------------------------
-- policy_alerts
-- ----------------------------------------
create table if not exists public.policy_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  -- discriminator: bill_event | bop_hearing | fda_action | dea_action |
  -- news_break | intel_tip | scraper_stale | briefing_published
  severity text not null default 'watch',
  -- routine | watch | alert | critical
  title text not null,
  body text,
  -- "FED" for federal, two-letter state code, or "ALL" for nationwide
  locality text not null default 'ALL',
  source_url text,
  -- optional links to existing entities the alert is about
  bill_id uuid references public.bills(id) on delete set null,
  briefing_slug text,
  bop_board_id uuid,
  -- if this alert should auto-spawn a campaign on creation
  action_required boolean not null default false,
  campaign_id uuid references public.campaigns(id) on delete set null,
  -- intel-tip provenance (set when kind='intel_tip')
  submitted_by_user_id uuid references public.profiles(id) on delete set null,
  is_anonymous boolean not null default false,
  -- moderation lifecycle for intel_tip; pre-approved for system kinds
  moderation_status text not null default 'approved',
  -- approved | pending | rejected
  moderation_note text,
  moderated_by uuid references public.profiles(id) on delete set null,
  moderated_at timestamptz,
  -- expiration: routine alerts age out of /pulse after 7d, critical hold for 24h then become 'alert'
  occurs_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_alerts_kind_chk check (kind in (
    'bill_event','bop_hearing','fda_action','dea_action',
    'news_break','intel_tip','scraper_stale','briefing_published'
  )),
  constraint policy_alerts_severity_chk check (severity in (
    'routine','watch','alert','critical'
  )),
  constraint policy_alerts_locality_chk check (
    locality = 'FED' or locality = 'ALL' or locality ~ '^[A-Z]{2}$'
  ),
  constraint policy_alerts_moderation_chk check (moderation_status in (
    'approved','pending','rejected'
  ))
);

create index if not exists ix_policy_alerts_pulse
  on public.policy_alerts (severity, created_at desc)
  where moderation_status = 'approved';
create index if not exists ix_policy_alerts_locality
  on public.policy_alerts (locality, created_at desc)
  where moderation_status = 'approved';
create index if not exists ix_policy_alerts_kind
  on public.policy_alerts (kind, created_at desc);
create index if not exists ix_policy_alerts_intel_queue
  on public.policy_alerts (created_at desc)
  where moderation_status = 'pending';

alter table public.policy_alerts enable row level security;

drop policy if exists policy_alerts_read_approved on public.policy_alerts;
create policy policy_alerts_read_approved
  on public.policy_alerts
  for select
  to public
  using (moderation_status = 'approved');

drop policy if exists policy_alerts_admin_all on public.policy_alerts;
create policy policy_alerts_admin_all
  on public.policy_alerts
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists policy_alerts_self_submit on public.policy_alerts;
create policy policy_alerts_self_submit
  on public.policy_alerts
  for insert
  to authenticated
  with check (
    kind = 'intel_tip'
    and moderation_status = 'pending'
    and submitted_by_user_id = auth.uid()
  );

drop policy if exists policy_alerts_self_read on public.policy_alerts;
create policy policy_alerts_self_read
  on public.policy_alerts
  for select
  to authenticated
  using (submitted_by_user_id = auth.uid());

-- ----------------------------------------
-- bop_boards (50 states + DC)
-- ----------------------------------------
create table if not exists public.bop_boards (
  id uuid primary key default gen_random_uuid(),
  state text not null unique,
  board_name text not null,
  website text,
  contact_email text,
  contact_phone text,
  meeting_schedule_url text,
  agenda_format text,
  -- 'pdf' | 'web' | 'rss' | 'unknown'
  scraper_config jsonb,
  -- per-board scraper instructions; null means not yet configured
  kratom_stance text not null default 'unknown',
  -- unknown | quiet | watching | proposed_scheduling | scheduled
  notes text,
  -- admin-only annotations
  last_scraped_at timestamptz,
  last_scrape_status text,
  -- ok | error | stale
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bop_boards_state_chk check (state ~ '^[A-Z]{2}$'),
  constraint bop_boards_stance_chk check (kratom_stance in (
    'unknown','quiet','watching','proposed_scheduling','scheduled'
  ))
);

-- Wire policy_alerts.bop_board_id now that bop_boards exists.
alter table public.policy_alerts
  add constraint policy_alerts_bop_fk
  foreign key (bop_board_id) references public.bop_boards(id) on delete set null;

alter table public.bop_boards enable row level security;

drop policy if exists bop_boards_public_read on public.bop_boards;
create policy bop_boards_public_read
  on public.bop_boards
  for select
  to public
  using (true);

drop policy if exists bop_boards_admin_all on public.bop_boards;
create policy bop_boards_admin_all
  on public.bop_boards
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Seed all 50 states + DC with known board names. Contact info,
-- meeting URLs, scraper configs are filled in via /admin/bops over
-- time — but having the directory rows present means policy_alerts
-- can FK to them and the /bops map can render placeholder rows.
insert into public.bop_boards (state, board_name) values
  ('AL', 'Alabama Board of Pharmacy'),
  ('AK', 'Alaska Board of Pharmacy'),
  ('AZ', 'Arizona State Board of Pharmacy'),
  ('AR', 'Arkansas State Board of Pharmacy'),
  ('CA', 'California State Board of Pharmacy'),
  ('CO', 'Colorado State Board of Pharmacy'),
  ('CT', 'Connecticut Commission of Pharmacy'),
  ('DE', 'Delaware Board of Pharmacy'),
  ('DC', 'DC Board of Pharmacy'),
  ('FL', 'Florida Board of Pharmacy'),
  ('GA', 'Georgia State Board of Pharmacy'),
  ('HI', 'Hawaii Board of Pharmacy'),
  ('ID', 'Idaho State Board of Pharmacy'),
  ('IL', 'Illinois Department of Financial and Professional Regulation — Pharmacy'),
  ('IN', 'Indiana Board of Pharmacy'),
  ('IA', 'Iowa Board of Pharmacy'),
  ('KS', 'Kansas State Board of Pharmacy'),
  ('KY', 'Kentucky Board of Pharmacy'),
  ('LA', 'Louisiana Board of Pharmacy'),
  ('ME', 'Maine Board of Pharmacy'),
  ('MD', 'Maryland Board of Pharmacy'),
  ('MA', 'Massachusetts Board of Registration in Pharmacy'),
  ('MI', 'Michigan Board of Pharmacy'),
  ('MN', 'Minnesota Board of Pharmacy'),
  ('MS', 'Mississippi Board of Pharmacy'),
  ('MO', 'Missouri Board of Pharmacy'),
  ('MT', 'Montana Board of Pharmacy'),
  ('NE', 'Nebraska Board of Pharmacy'),
  ('NV', 'Nevada State Board of Pharmacy'),
  ('NH', 'New Hampshire Board of Pharmacy'),
  ('NJ', 'New Jersey State Board of Pharmacy'),
  ('NM', 'New Mexico Board of Pharmacy'),
  ('NY', 'New York Board of Pharmacy'),
  ('NC', 'North Carolina Board of Pharmacy'),
  ('ND', 'North Dakota Board of Pharmacy'),
  ('OH', 'State of Ohio Board of Pharmacy'),
  ('OK', 'Oklahoma State Board of Pharmacy'),
  ('OR', 'Oregon Board of Pharmacy'),
  ('PA', 'Pennsylvania State Board of Pharmacy'),
  ('RI', 'Rhode Island Board of Pharmacy'),
  ('SC', 'South Carolina Board of Pharmacy'),
  ('SD', 'South Dakota Board of Pharmacy'),
  ('TN', 'Tennessee Board of Pharmacy'),
  ('TX', 'Texas State Board of Pharmacy'),
  ('UT', 'Utah Division of Occupational and Professional Licensing — Pharmacy'),
  ('VT', 'Vermont Board of Pharmacy'),
  ('VA', 'Virginia Board of Pharmacy'),
  ('WA', 'Washington State Board of Pharmacy'),
  ('WV', 'West Virginia Board of Pharmacy'),
  ('WI', 'Wisconsin Pharmacy Examining Board'),
  ('WY', 'Wyoming State Board of Pharmacy')
on conflict (state) do nothing;

-- ----------------------------------------
-- scraper_runs (observability for cron pipeline)
-- ----------------------------------------
create table if not exists public.scraper_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  -- 'legiscan_bills' | 'openstates_bills' | 'bop_<state>' | 'fda_press' | etc.
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  -- running | success | error | empty
  rows_added integer,
  rows_updated integer,
  error_message text,
  notes text
);

create index if not exists ix_scraper_runs_recent
  on public.scraper_runs (source, started_at desc);

-- Helper for /admin/intel-health: most recent run per source in one query.
create or replace view public.scraper_runs_latest as
  select distinct on (source)
    source, started_at, finished_at, status, rows_added, rows_updated, error_message
  from public.scraper_runs
  order by source, started_at desc;

alter table public.scraper_runs enable row level security;

drop policy if exists scraper_runs_admin_only on public.scraper_runs;
create policy scraper_runs_admin_only
  on public.scraper_runs
  for select
  to authenticated
  using (public.is_admin(auth.uid()));

-- ----------------------------------------
-- campaigns.mobilization_type
-- ----------------------------------------
alter table public.campaigns
  add column if not exists mobilization_type text not null default 'constituent';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'campaigns_mobilization_chk'
       and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_mobilization_chk
      check (mobilization_type in ('constituent','solidarity','both'));
  end if;
end$$;

-- ----------------------------------------
-- updated_at maintenance
-- ----------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_policy_alerts_updated on public.policy_alerts;
create trigger trg_policy_alerts_updated
  before update on public.policy_alerts
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_bop_boards_updated on public.bop_boards;
create trigger trg_bop_boards_updated
  before update on public.bop_boards
  for each row execute function public.touch_updated_at();

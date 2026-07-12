-- ============================================================
-- 0244 — review-by failsafe (dead-bill / stale-item safeguard)
-- ============================================================
-- Owner directive (2026-07-11): everything scraped/uploaded must carry a
-- "review by" deadline recorded UP FRONT, so proposed legislation that dies
-- when a session ends (or is never heard) stops showing as active, and any
-- alerts/campaigns tied to it are retired in the same pass. "It all must have a
-- beginning and an end, and an if/then or two."
--
-- Uniform review-date semantics across the scraped entities (reusing existing
-- deadline columns where they already exist, so we don't duplicate expiry
-- logic):
--   bills       → review_by (NEW) + session_sine_die (NEW)
--   policy_alerts → expires_at (existing)
--   campaigns   → ends_at (existing) + review_state workflow (existing)
--
-- The authoritative "is this session over?" signal is LegiScan's sine_die flag,
-- captured per state in legislative_sessions (a guess like "Dec 31 of the end
-- year" keeps a spring-adjourned bill alive for months — sine_die is exact).
--
-- Rollback:
--   alter table public.bills drop column if exists review_by, drop column if exists session_sine_die;
--   drop table if exists public.legislative_sessions;

alter table public.bills
  add column if not exists review_by timestamptz,
  add column if not exists session_sine_die boolean not null default false;

comment on column public.bills.review_by is
  'Deadline to re-check this bill''s liveness (session end / hearing date). When it lapses and the bill has not passed, the review cron retires it. Set up front at sync time.';
comment on column public.bills.session_sine_die is
  'True once the bill''s legislative session has adjourned sine die (LegiScan). A non-enacted bill in a sine_die session is dead.';

-- Partial index for the daily review scan (only active bills with a deadline).
create index if not exists bills_review_by_active_idx
  on public.bills (review_by)
  where active = true and review_by is not null;

-- ---------- legislative_sessions: authoritative session calendar ----------
create table if not exists public.legislative_sessions (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  legiscan_session_id integer unique,
  session_name text,
  year_start int,
  year_end int,
  special boolean not null default false,
  sine_die boolean not null default false,
  synced_at timestamptz not null default now()
);
create index if not exists legislative_sessions_state_idx
  on public.legislative_sessions (state, year_end desc);

alter table public.legislative_sessions enable row level security;

-- Public read (session calendars are public record); writes are service-role
-- only (the sync script), so no write policy is granted.
drop policy if exists legislative_sessions_public_read on public.legislative_sessions;
create policy legislative_sessions_public_read on public.legislative_sessions
  for select using (true);

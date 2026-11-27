-- 0339_official_roster_checks.sql
--
-- The officials-turnover engine reads each state chamber's OWN member list
-- (scripts/check-official-rosters.mjs, daily). Two uses:
--
-- 1. A second source for the handover. Until now a seat changed hands only
--    when openstates/people showed the newcomer in office, and after the 2026
--    general it lagged for weeks: 167 seats in FL, IN, TN, SC, AL, DE, HI and
--    OK sat past their handover day with the outgoing member still active and
--    the new member missing. When the chamber's page lists the winner and no
--    longer lists the outgoing member, the seat gets an official-roster:<day>
--    tag, and turnover-swap.mjs retires the outgoing member and adds the new
--    one. The address the chamber prints for them, if any, is kept here so the
--    new row can be written to on day one (winner_email, winner_source_url).
--
-- 2. A year-round census. A member we list as active who is missing from a
--    page that lists nearly everyone else may have resigned, died or been
--    replaced between elections. One row per person in official_roster_checks,
--    counting the days in a row they were missing. It is a review list only:
--    nobody is retired on an absence.
--
-- Flat tables, nothing kratom-specific. Officials' names and office addresses
-- are public record, so seat_elections keeps its public read. The census is
-- admin-only. Grants are explicit (no default grants after 2026-10-30).
--
-- Rollback: drop table public.official_roster_checks;
--           alter table public.seat_elections drop column winner_email, drop column winner_source_url;

alter table public.seat_elections
  add column if not exists winner_email      text,  -- printed on the chamber's own member list, never guessed
  add column if not exists winner_source_url text;  -- the member list that showed the winner in office

create table if not exists public.official_roster_checks (
  id              uuid primary key default gen_random_uuid(),
  legislator_id   uuid not null references public.legislators(id) on delete cascade,
  state           text not null,
  office          text not null,                 -- a legislators.role value
  url             text not null,                 -- the member list they were missing from
  first_missed_on date not null,
  last_missed_on  date not null,
  misses          integer not null default 1,    -- days in a row
  cleared_on      date,                          -- listed again (a name-format miss, or back from leave)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint official_roster_checks_one_per_person unique (legislator_id)
);

alter table public.official_roster_checks enable row level security;

drop policy if exists "admins read official roster checks" on public.official_roster_checks;
create policy "admins read official roster checks" on public.official_roster_checks
  for select to authenticated using (public.is_admin(auth.uid()));

grant select on public.official_roster_checks to authenticated;
grant all on public.official_roster_checks to service_role;

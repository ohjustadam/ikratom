-- 0277_officials_turnover_calendar.sql
--
-- The officials-turnover engine, parts (a)-(d) (owner ask 2026-10-23: "no gaps
-- in information loss when official turnover happens"; plan
-- private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md §1). Two flat tables,
-- nothing kratom-specific, so the civic core can serve any cause.
--
-- term_calendar — when each office turns over, per election cycle, as DATA.
--   One row per (state, office, cycle). Seats up come from NCSL's "legislative
--   races by state and chamber" table; the day winners take office comes from
--   a term-start rule that must reproduce the start dates openstates/people
--   recorded in the two most recent observed cycles (scripts/lib/term-calendar.mjs).
--   A chamber with no rule that fits both cycles keeps new_term_starts NULL:
--   a wrong handover date is worse than none.
--
-- seat_elections — the seat-level ledger. One row per seat on a ballot. It
--   drives the "on the ballot" flag (status on_ballot), result ingestion
--   (incumbent_reelected / successor_elected, with every source that agreed in
--   result_sources), and the dated swap (swapped, once the handover date has
--   passed AND a second source shows the successor in office). Anything a
--   single source cannot settle is needs_review, listed on
--   /admin/local-rep-requests. Rows are kept after the swap: the history of
--   who held a seat is never deleted.
--
-- Why term_end_date is set from here and not from start + term length: the
-- seat's cycle decides when its term ends. An appointee serves the remainder
-- of the seat's term, so start + length is wrong for exactly the people it
-- matters most for (memory openstates-people-term-dates).
--
-- Public read (all of this is public record); writes are service-role crons
-- and admins. Supabase stops granting new public tables by default on
-- 2026-10-30, so the grants are explicit.
--
-- Rollback: drop table public.seat_elections; drop table public.term_calendar;

create table if not exists public.term_calendar (
  id               uuid primary key default gen_random_uuid(),
  state            text not null,              -- two-letter code; 'US' for Congress-wide rows
  office           text not null,              -- a legislators.role value (state_senate, us_house, ...)
  cycle_year       integer not null,           -- the election year
  election_date    date,
  term_years       integer,
  total_seats      integer,
  seats_up         integer,                    -- regularly scheduled seats on this cycle's ballot
  seat_list_status text not null default 'unverified'
                   check (seat_list_status in ('all', 'none', 'listed', 'unverified')),
  term_start_rule  text,                       -- e.g. 'election+15d', 'nth:1:2:1' (2nd Monday of January)
  new_term_starts  date,                       -- the handover day: winners take office, the outgoing term ends
  rule_evidence    text,                       -- the observed cycles that prove the rule
  sources_md       text,
  synced_at        timestamptz not null default now(),
  unique (state, office, cycle_year)
);

create table if not exists public.seat_elections (
  id              uuid primary key default gen_random_uuid(),
  state           text not null,
  office          text not null,
  district        text not null default '',    -- '' for a statewide office
  seat            text not null default '',    -- '' for a single-member seat; the sitting member's id in a multi-member district
  election_date   date not null,
  kind            text not null default 'regular' check (kind in ('regular', 'special')),
  incumbent_id    uuid references public.legislators(id) on delete set null,
  incumbent_name  text,
  status          text not null default 'on_ballot'
                  check (status in ('on_ballot', 'incumbent_reelected', 'successor_elected', 'needs_review', 'swapped', 'cancelled')),
  handover_date   date,
  winner_name     text,
  winner_id       uuid references public.legislators(id) on delete set null,
  result_sources  text[] not null default '{}',
  sources_md      text,
  review_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (state, office, district, seat, election_date, kind)
);
create index if not exists ix_seat_elections_incumbent on public.seat_elections (incumbent_id) where incumbent_id is not null;
create index if not exists ix_seat_elections_open on public.seat_elections (status, handover_date)
  where status in ('on_ballot', 'successor_elected', 'needs_review');

alter table public.term_calendar enable row level security;
alter table public.seat_elections enable row level security;

create policy "term_calendar: public read" on public.term_calendar for select using (true);
create policy "term_calendar: admin write" on public.term_calendar for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "seat_elections: public read" on public.seat_elections for select using (true);
create policy "seat_elections: admin write" on public.seat_elections for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.term_calendar, public.seat_elections to anon, authenticated;
grant insert, update, delete on public.term_calendar, public.seat_elections to authenticated;
grant all on public.term_calendar, public.seat_elections to service_role;

-- 0269: record WHERE each local-rep coverage request came from.
--
-- The admin queue said "1 user waiting" on rows the nightly hot-zone seeder
-- files under the owner's account (93 of 146 requests ever, 91 in one week),
-- so the owner read a daily batch as one member flooding the queue. Values:
--   member          someone clicked "Request coverage" on their dashboard
--   signup          filed for a member's own city/county when they saved an address
--   hotzone_seed    scripts/seed-hotzone-officials.mjs (kratom on a nearby agenda)
--   roster_refresh  scripts/refresh-local-rosters.mjs (a stale roster re-queued)
--
-- Backfill: a row created while one of those two jobs was running is that
-- job's (scraper_runs has each run's window). Older signup rows can't be told
-- apart from clicks and stay 'member'.
--
-- Rollback: alter table public.local_rep_requests drop column source;

alter table public.local_rep_requests
  add column if not exists source text not null default 'member';

alter table public.local_rep_requests drop constraint if exists local_rep_requests_source_check;
alter table public.local_rep_requests add constraint local_rep_requests_source_check
  check (source in ('member', 'signup', 'hotzone_seed', 'roster_refresh'));

update public.local_rep_requests r
set source = j.src
from (
  select case source when 'seed_hotzone_officials' then 'hotzone_seed' else 'roster_refresh' end as src,
         started_at, finished_at
  from public.scraper_runs
  where source in ('seed_hotzone_officials', 'refresh_local_rosters')
    and started_at is not null and finished_at is not null
) j
where r.created_at between j.started_at and j.finished_at + interval '5 seconds'
  and r.source = 'member';

-- 0326_email_deliveries.sql
--
-- Which member got which email (2026-11-18 scale audit).
--
-- scripts/send-email-notifications.mjs ran out of daily quota cleanly but then
-- re-sent: a "partial" run kept the old watermark, so the next meetings run
-- emailed the same alert again to everyone who already had it, and the daily
-- digest always went to the same first ~350 members. One row per delivered
-- email per item lets every run skip what a member already has and send to
-- the members emailed longest ago first (scripts/lib/email-ledger.mjs).
--
--   source  'digest' | 'meeting' | 'announce'
--   ref     digest: the Eastern date; meeting: municipal_meetings.id; announce: the slug
--
-- The sender prunes rows older than 45 days. Service role only.
--
-- Rollback: drop table public.email_deliveries;

create table if not exists public.email_deliveries (
  source   text not null check (source in ('digest', 'meeting', 'announce')),
  ref      text not null check (length(ref) between 1 and 200),
  user_id  uuid not null references auth.users (id) on delete cascade,
  sent_at  timestamptz not null default now(),
  primary key (source, ref, user_id)
);

create index if not exists email_deliveries_source_sent_idx
  on public.email_deliveries (source, sent_at);

alter table public.email_deliveries enable row level security;

-- Members never read or write this table; only the cron sender (service role) does.
drop policy if exists email_deliveries_no_client on public.email_deliveries;
create policy email_deliveries_no_client on public.email_deliveries
  for all to anon, authenticated using (false) with check (false);

-- New public tables get no default grants since 2026-10-30.
revoke all on public.email_deliveries from anon, authenticated;
grant select, insert, update, delete on public.email_deliveries to service_role;

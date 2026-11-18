-- 0325_signup_email_queue.sql
--
-- Signups that Supabase Auth could not email (2026-11-17 scale audit).
--
-- Supabase sends signup confirmations through Resend under a project-wide cap
-- of 30 an hour (rate_limit_email_sent) and Resend's own 100 a day. Past
-- either, Supabase rolls the signup back and sends nothing. In a rush that lost
-- every signup past the 30th in an hour, and the form told those people to
-- check their inbox.
--
-- Now src/modules/auth/signup-queue.ts makes the account through the admin API
-- (unconfirmed, no email) and puts the address here. Every hour
-- scripts/send-queued-signup-links.mjs mails its confirm link through the cron
-- email pool (Brevo first, a separate daily quota), oldest first.
--
-- Service role only. One row per address, lower-cased.
--
-- Rollback: drop table public.signup_email_queue;

create table if not exists public.signup_email_queue (
  email       text primary key check (email = lower(email) and length(email) <= 254),
  user_id     uuid references auth.users (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'sent', 'confirmed', 'failed')),
  attempts    integer not null default 0,
  last_error  text check (length(last_error) <= 500),
  queued_at   timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists signup_email_queue_pending_idx
  on public.signup_email_queue (queued_at) where status = 'pending';

alter table public.signup_email_queue enable row level security;

-- Members never read or write this table; only the server (service role) does.
-- An explicit deny keeps the advisor from listing it as "RLS on, no policy".
drop policy if exists signup_email_queue_no_client on public.signup_email_queue;
create policy signup_email_queue_no_client on public.signup_email_queue
  for all to anon, authenticated using (false) with check (false);

-- New public tables get no default grants since 2026-10-30.
revoke all on public.signup_email_queue from anon, authenticated;
grant select, insert, update, delete on public.signup_email_queue to service_role;

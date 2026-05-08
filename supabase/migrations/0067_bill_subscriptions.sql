-- ============================================================
-- 0067_bill_subscriptions
--
-- Per-user opt-in to a specific bill so the system can:
--   - Send a meeting reminder ~24h before bills.local_meta.meeting_at
--   - Send a status-change notification when bills.status updates
--   - Send notifications when a new linked policy_alert lands
--
-- One row per (user, bill). The reminder cron sweeps these hourly,
-- finds bills whose meeting falls in the next 24h, and creates a
-- notification for every subscriber. Push fan-out is wired through
-- the existing notifications + push_subscriptions plumbing.
-- ============================================================

create table if not exists public.bill_subscriptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  notify_meeting_reminder boolean not null default true,
  notify_status_change boolean not null default true,
  notify_new_alert boolean not null default true,
  -- Track which reminders we've already fired so the cron doesn't
  -- spam the same user every hour. Updated when a notification is
  -- created for a given (subscription, event_type).
  meeting_reminded_at timestamptz,
  last_status_seen text,
  created_at timestamptz not null default now(),
  primary key (user_id, bill_id)
);

create index if not exists ix_bill_subscriptions_bill
  on public.bill_subscriptions (bill_id);

-- For the "find subscriptions whose bill has a meeting in next 24h"
-- query the cron runs.
create index if not exists ix_bill_subscriptions_meeting_pending
  on public.bill_subscriptions (bill_id)
  where notify_meeting_reminder = true and meeting_reminded_at is null;

alter table public.bill_subscriptions enable row level security;

drop policy if exists bill_subscriptions_self on public.bill_subscriptions;
create policy bill_subscriptions_self
  on public.bill_subscriptions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

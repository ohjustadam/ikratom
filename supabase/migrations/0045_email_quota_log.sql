-- ============================================================
-- 0045_email_quota_log
--
-- Tracks transactional email sends per provider per day so the
-- multi-provider router can fail over when the daily free cap on one
-- provider is reached. We don't need second-by-second precision; a
-- daily aggregate per provider is enough to power the routing decision.
--
-- Why the schema uses (provider, day) PK + counter rather than one row
-- per send: write amplification. We send a lot of small emails (push,
-- alerts, reminders) and a row-per-send table grows fast for marginal
-- analytics value. The per-day aggregate is cheap to upsert and is what
-- the router actually needs ("am I under cap on Resend today?").
--
-- For full per-send audit, the existing audit_log table records the
-- mod.* events that triggered the email; combine if needed.
-- ============================================================

create table if not exists public.email_quota_log (
  provider text not null check (provider in ('resend','brevo','mailjet','mailersend','ses')),
  day date not null default current_date,
  sent_count int not null default 0,
  failed_count int not null default 0,
  last_send_at timestamptz,
  primary key (provider, day)
);

-- Cron-friendly: prune rows older than 90 days. Keeps the table small.
create or replace function public.prune_email_quota_log()
returns void
language sql
security definer
as $$
  delete from public.email_quota_log
   where day < current_date - interval '90 days';
$$;

-- Service-role-only access; never queried client-side.
alter table public.email_quota_log enable row level security;

drop policy if exists "email_quota_log_admin_select" on public.email_quota_log;
create policy "email_quota_log_admin_select"
  on public.email_quota_log for select to authenticated
  using (public.is_admin(auth.uid()));

-- Insert/update happens via the service-role client only (cron context),
-- so no user-side INSERT policy is needed. The router runs in server
-- actions / cron, both of which use the service-role client when
-- writing here.

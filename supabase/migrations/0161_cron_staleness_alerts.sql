-- ============================================================
-- 0161_cron_staleness_alerts
--
-- Tracks which cron sources are currently in a "silent" state and
-- whether the operator has been notified about the silence yet.
-- Backs scripts/check-cron-staleness.mjs which runs every 30min:
--
--   1. Iterate every source in CRON_REGISTRY
--   2. Find most-recent scraper_runs row
--   3. If age > 3x expected interval (silent state) AND not already
--      flagged → insert row + push notification to owner
--   4. If source recovers (recent run found) AND was flagged →
--      delete row (silent state cleared)
--
-- The "alerted_at" + "cleared_at" columns let us see the full silent
-- period in retrospect — useful for incident postmortems.
--
-- Rollback:
--   DROP TABLE IF EXISTS cron_staleness_alerts;

create table if not exists public.cron_staleness_alerts (
  source       text primary key,
  -- Most recent successful run we observed for this source. Used to
  -- detect "this source has recovered" later.
  last_seen_at timestamptz,
  -- When we first noticed the silence + sent the push.
  alerted_at   timestamptz not null default now(),
  -- When the source recovered (next-pass observation). Null = still
  -- silent. Once cleared, the row is deleted (we don't keep history;
  -- the admin_audit_log has the alert + clear events).
  cleared_at   timestamptz,
  -- For debugging: which system the source belonged to.
  system       text,
  cadence      text
);

create index if not exists cron_staleness_alerts_alerted_idx
  on public.cron_staleness_alerts (alerted_at desc);

-- RLS: admin-read-only. Writes only via service-role from the
-- check-cron-staleness script.
alter table public.cron_staleness_alerts enable row level security;

drop policy if exists "cron_staleness: admin read" on public.cron_staleness_alerts;
create policy "cron_staleness: admin read"
  on public.cron_staleness_alerts for select
  using (public.is_admin(auth.uid()));

comment on table public.cron_staleness_alerts is
  'State table for proactive cron-staleness push alerts. Rows mean "we currently believe this source is silent and we have already pinged the owner about it." Deleted when the source recovers.';

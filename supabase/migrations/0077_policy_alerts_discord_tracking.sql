-- ============================================================
-- 0077_policy_alerts_discord_tracking
--
-- Add discord_posted_at to policy_alerts so the per-hour
-- post-bill-alerts-to-discord script can dedupe — once an alert is
-- posted to all integrated channels, mark it so we don't repost on
-- next cron tick.
-- ============================================================

alter table public.policy_alerts
  add column if not exists discord_posted_at timestamptz;

-- Index for the script's filter — only matters for rows not yet posted
create index if not exists ix_policy_alerts_discord_pending
  on public.policy_alerts (created_at desc)
  where discord_posted_at is null
    and moderation_status = 'approved'
    and kind = 'bill_event'
    and severity in ('critical', 'alert');

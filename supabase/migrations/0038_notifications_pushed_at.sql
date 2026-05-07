-- ============================================================
-- 0038_notifications_pushed_at
--
-- Tracks which notifications have already been delivered via Web Push.
-- Lets the hourly cron find unpushed rows without re-sending old ones.
--
-- Cron flow (in /api/cron/fire-waves):
--   select id, user_id, kind, title, body, link
--     from notifications
--    where pushed_at is null
--      and created_at > now() - interval '24 hours'
--    limit 500;
--   → for each, send web-push to all of that user's push_subscriptions
--   → update notifications set pushed_at = now() where id = any(:sent_ids)
--
-- We cap to last-24h so a backlog after a long outage doesn't spam users
-- with a flood of stale "this happened yesterday" notifications.
-- ============================================================

alter table public.notifications
  add column if not exists pushed_at timestamptz;

-- Partial index — only the unpushed rows matter for the cron sweep.
-- Tiny index, fast lookup even as the notifications table grows.
create index if not exists idx_notifications_unpushed
  on public.notifications (created_at)
  where pushed_at is null;

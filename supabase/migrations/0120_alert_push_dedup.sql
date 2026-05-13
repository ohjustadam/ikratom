-- 0120: Track per-alert push fanout to prevent re-pushing on every cron tick.
--
-- New script push-critical-alerts.mjs runs hourly, finds approved
-- policy_alerts that haven't been broadcast yet, and creates per-user
-- notifications rows for in-state users. We need a stamp on the alert
-- itself so we know which ones we've already fanned out.
--
-- This is different from notifications.pushed_at (which dedupes web
-- push delivery per-notification). This is at the alert level —
-- "have we ever generated notifications from this alert?"
--
-- Rollback:
--   ALTER TABLE policy_alerts DROP COLUMN IF EXISTS auto_pushed_at;
--   ALTER TABLE policy_alerts DROP COLUMN IF EXISTS auto_pushed_count;

ALTER TABLE policy_alerts
  ADD COLUMN IF NOT EXISTS auto_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pushed_count int;

COMMENT ON COLUMN policy_alerts.auto_pushed_at IS
  'When the auto-push cron fanned this alert out to in-state users. NULL = not pushed yet.';
COMMENT ON COLUMN policy_alerts.auto_pushed_count IS
  'Number of in-state users that received an in-app notification from the auto-push cron.';

-- Index to make the cron's "find unpushed approved critical alerts" query fast.
CREATE INDEX IF NOT EXISTS ix_policy_alerts_unpushed
  ON policy_alerts (created_at DESC)
  WHERE auto_pushed_at IS NULL
    AND moderation_status = 'approved'
    AND severity IN ('critical', 'alert');

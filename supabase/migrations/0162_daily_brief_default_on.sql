-- 0162_daily_brief_default_on.sql
--
-- The daily brief push notification opt-in (added in 0158) defaulted
-- to FALSE — which meant nobody got the morning digest until they
-- toggled it on manually. Nobody knew it was a thing, so nobody did.
--
-- Two changes:
--   1. Flip the column default to TRUE so every NEW profile auto-gets
--      the digest. Users can still opt out from the settings UI.
--   2. Retroactively flip every EXISTING row to TRUE. Owner explicitly
--      asked for this one-time backfill on 2026-05-28 — "no one knew
--      to turn it on."
--
-- Rollback: ALTER COLUMN daily_brief_push SET DEFAULT false; UPDATE
-- notification_preferences SET daily_brief_push = false.

ALTER TABLE notification_preferences
  ALTER COLUMN daily_brief_push SET DEFAULT true;

UPDATE notification_preferences
SET daily_brief_push = true,
    updated_at = now()
WHERE daily_brief_push IS DISTINCT FROM true;

-- 0163_push_subscription_origin.sql
--
-- Track the origin a push subscription was registered against. Owner
-- hit a bug 2026-05-28: a service worker registered while testing on
-- localhost:3001 received a daily-brief push and tried to navigate the
-- click to localhost — ERR_CONNECTION_REFUSED.
--
-- We can't detect this from the FCM endpoint (same shape regardless
-- of origin), so we store window.location.origin at subscribe time.
-- The prune routine in fire-daily-brief-push leaves null origins alone
-- (legacy rows) — we only delete subs whose origin actively says
-- localhost / 127.0.0.1.
--
-- Rollback: ALTER TABLE push_subscriptions DROP COLUMN origin;

ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS origin text;

COMMENT ON COLUMN push_subscriptions.origin IS
  'window.location.origin at SW subscribe time. Used to prune dev subscriptions that point at localhost.';

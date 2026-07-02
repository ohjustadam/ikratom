-- ============================================================
-- 0226 — push_subscriptions endpoint host allowlist (SSRF, defense-in-depth)
-- ============================================================
-- The push `endpoint` is a server-fetched URL (sendPush POSTs to it on
-- subscribe + hourly). savePushSubscription now rejects non-push-service
-- endpoints in app code (src/lib/push/allowlist.ts), and sendPush re-checks.
-- This DB CHECK is the backstop — mirroring the Discord webhook_url CHECK — so
-- no path (including a future direct/service-role insert) can store an endpoint
-- pointing at an arbitrary/internal host.
--
-- Allowed hosts (the four Web Push services): fcm.googleapis.com,
-- *.push.services.mozilla.com, *.notify.windows.com, *.push.apple.com — https only.
--
-- NOT VALID: enforce on new inserts/updates without validating historical rows
-- (all real subscriptions already satisfy it; NOT VALID just avoids a scan/abort
-- risk on a legacy row). Rollback: drop constraint push_endpoint_known_host.

alter table public.push_subscriptions
  drop constraint if exists push_endpoint_known_host;

alter table public.push_subscriptions
  add constraint push_endpoint_known_host check (
    endpoint ~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)(/|$)'
  ) not valid;

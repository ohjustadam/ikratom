-- 0229: VALIDATE the push_subscriptions endpoint-host constraint (SSRF backstop)
--
-- 0226 added the endpoint-host allowlist CHECK as NOT VALID — so it enforced
-- only new/updated rows and never validated existing ones (pen-test 2026-07-02,
-- LOW). Verified against prod: 0 of the current rows violate the allowlist, so
-- validating is safe and non-disruptive. Once VALIDATED the constraint holds for
-- ALL rows, which also makes the direct-send cron scripts (fire-*-push.mjs) safe
-- by construction — they POST to push_subscriptions.endpoint, and no row can now
-- hold an endpoint pointing at an arbitrary/internal host.
--
-- Rollback: the constraint stays; to loosen, `alter table ... drop constraint
-- push_endpoint_known_host;` (defeats the SSRF backstop — don't).

alter table public.push_subscriptions
  validate constraint push_endpoint_known_host;

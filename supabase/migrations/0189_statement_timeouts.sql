-- 0189_statement_timeouts.sql
--
-- Free-tier OOM backstop (2026-06-08 outage).
--
-- The ~400MB free-tier Postgres instance was OOM-killed and refused all
-- connections (ECONNREFUSED on :5432) after a heavy/concurrent query load
-- exhausted per-backend work_mem. The single highest-leverage structural
-- guard is a per-role statement_timeout: it converts a pathological
-- long-running query into a fast, CLEAN error (which the app already
-- handles as a normal query failure) instead of letting it accumulate
-- memory until the kernel kills the postmaster. The DB then degrades
-- gracefully rather than crash-and-refuse.
--
-- Per-role (NOT on `authenticator`) so we differentiate interactive web
-- traffic from cron:
--   anon / authenticated  → 8s  (public pages + logged-in users; any
--                                 legitimate single query is well under 1s,
--                                 so 8s only ever catches a runaway)
--   service_role          → 300s (cron / maintenance scripts do legitimate
--                                  bulk upserts + sweeps; generous but still
--                                  bounded so nothing can run forever)
-- We deliberately do NOT set it on `authenticator` (PostgREST's login role)
-- because that would blanket BOTH web and cron with the same limit and could
-- abort legitimate bulk cron operations.
--
-- ⚠ VALIDATE AFTER APPLYING (these apply to NEW connections; PostgREST pools,
--   so give it a moment or restart the API). Quick checks:
--     1. As anon (public): a deliberately slow query should cancel at ~8s
--        with `canceling statement due to statement timeout`.
--     2. Re-run a normal cron sync (e.g. node scripts/sync-lda-kratom.mjs)
--        and confirm it still completes — service_role gets 300s.
--
-- Rollback:
--   ALTER ROLE anon RESET statement_timeout;
--   ALTER ROLE authenticated RESET statement_timeout;
--   ALTER ROLE service_role RESET statement_timeout;
--   ALTER ROLE authenticated RESET idle_in_transaction_session_timeout;

ALTER ROLE anon          SET statement_timeout = '8s';
ALTER ROLE authenticated SET statement_timeout = '8s';
ALTER ROLE service_role  SET statement_timeout = '300s';

-- Also cap idle-in-transaction so a stuck/abandoned transaction can't pin a
-- connection + its memory indefinitely (another way the tiny instance bleeds).
ALTER ROLE anon          SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE authenticated SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE service_role  SET idle_in_transaction_session_timeout = '120s';

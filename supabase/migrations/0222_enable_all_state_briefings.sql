-- 0222_enable_all_state_briefings.sql
--
-- Intent: make the per-state daily briefing actually daily for EVERY state.
--
-- Migration 0110 added states.briefing_gen_enabled (default false) and seeded
-- it true for NY ONLY. The daily cron runs `generate-state-briefing.mjs
-- --all-states`, which filters to enabled states — so only NY ever regenerated
-- and the other 50 sat frozen at their seed (OK's active briefing was 44 days
-- stale). Owner ask 2026-06-25: state briefs must refresh daily everywhere and
-- carry full content on the State HQ page. The cron job already budgets 30 min
-- for ~51 states (~5s each), so enabling all is within the existing envelope.
--
-- Enable every state and flip the default so any future state is on by default.
--
-- Rollback:
--   ALTER TABLE states ALTER COLUMN briefing_gen_enabled SET DEFAULT false;
--   UPDATE states SET briefing_gen_enabled = false WHERE abbr <> 'NY';

ALTER TABLE states ALTER COLUMN briefing_gen_enabled SET DEFAULT true;

UPDATE states
SET briefing_gen_enabled = true
WHERE briefing_gen_enabled IS DISTINCT FROM true;

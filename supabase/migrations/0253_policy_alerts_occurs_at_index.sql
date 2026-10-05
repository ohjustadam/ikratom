-- 0253_policy_alerts_occurs_at_index.sql
--
-- INTENT: give the upcoming-events / calendar query on policy_alerts an index
-- that matches how it actually filters.
--
-- Second-most expensive statement in the database over the 77-day pg_stat
-- window: 1,834 seconds across 4,569 calls (401 ms mean). Shape:
--
--   WHERE moderation_status = $1
--     AND occurs_at IS NOT NULL
--     AND occurs_at >= $2 AND occurs_at <= $3
--     AND severity = ANY ($4)
--   ORDER BY occurs_at
--
-- policy_alerts already carries nine indexes, but every one of them is keyed on
-- `created_at` (or on dedupe_key / locality / kind). NOTHING indexed
-- `occurs_at` — the column this query both range-filters AND sorts by. The
-- planner therefore picked `ix_policy_alerts_pulse` (severity, created_at DESC)
-- for the moderation_status predicate alone and then sorted the result:
--
--   before   Index Scan using ix_policy_alerts_pulse -> Sort (Sort Key: occurs_at)
--            Buffers: shared hit=2622, rows=1, Execution Time: 608.648 ms
--
-- 2,622 buffers to return a single row.
--
-- `occurs_at` leads so the range scan and the ORDER BY are both satisfied
-- directly, with no sort node. `severity` follows so the ANY(...) membership
-- test is checked in the index instead of on the heap. Partial on
-- `moderation_status = 'approved' AND occurs_at IS NOT NULL`, which keeps it to
-- the rows that can ever be calendar entries — most alerts have no occurs_at
-- at all.
--
-- The partial predicate is a literal while PostgREST sends `moderation_status`
-- as a parameter. That is fine here and not an oversight: Postgres builds
-- custom plans (parameters substituted) for early executions, which is how the
-- existing partial `ix_policy_alerts_pulse` was already being chosen by this
-- very query.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.ix_policy_alerts_calendar;

CREATE INDEX IF NOT EXISTS ix_policy_alerts_calendar
  ON public.policy_alerts (occurs_at, severity)
  WHERE moderation_status = 'approved' AND occurs_at IS NOT NULL;

COMMENT ON INDEX public.ix_policy_alerts_calendar IS
  'Serves the upcoming-events/calendar read: occurs_at range + ORDER BY '
  'occurs_at, severity membership in-index. Before this, all nine indexes on '
  'policy_alerts were keyed on created_at and the query sorted 2,622 buffers '
  'to return one row (608 ms).';

-- 0150 — Track AI-based news↔bill correlation attempts separately.
--
-- Migration 0149 added news_items.bill_correlation_attempted_at to
-- track when the regex-based correlator ran. The hourly cron sets it
-- on every row it touches, so we can't reuse it to gate the slower
-- AI-based pass — the AI pass would never see rows after the regex
-- pass finished.
--
-- This adds a separate timestamp for AI attempts. AI runs only on
-- rows where the regex pass already tried and couldn't find a match
-- (bill_id IS NULL but bill_correlation_attempted_at IS NOT NULL).
-- Setting bill_ai_correlation_attempted_at prevents the next AI pass
-- from re-evaluating the same row.
--
-- Rollback:
--   ALTER TABLE public.news_items DROP COLUMN IF EXISTS bill_ai_correlation_attempted_at;

ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS bill_ai_correlation_attempted_at timestamptz;

-- Partial index — most rows will stay unprocessed by the AI pass for
-- a while, so a partial index over the "pending AI" set keeps the
-- daily-cron query cheap.
CREATE INDEX IF NOT EXISTS news_items_bill_ai_correlation_pending_idx
  ON public.news_items (published_at DESC)
  WHERE bill_id IS NULL
    AND bill_correlation_attempted_at IS NOT NULL
    AND bill_ai_correlation_attempted_at IS NULL
    AND active = true;

COMMENT ON COLUMN public.news_items.bill_ai_correlation_attempted_at IS
  'When the AI-based bill correlator last ran on this row. NULL = still pending. AI pass runs only after the regex pass (bill_correlation_attempted_at) has tried and failed to find a match.';

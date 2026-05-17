-- 0149 — Direct news_items → bills correlation.
--
-- Today news links to bills indirectly through policy_alerts:
--   news_items.policy_alert_id → policy_alerts.id → policy_alerts.bill_id
--
-- That works when a news item triggered a policy alert, but most news
-- items don't have policy_alert_id set. So the per-bill "News coverage"
-- section on /bills/[id] under-counts substantially.
--
-- This migration adds a direct foreign key. Backfill happens in
-- scripts/correlate-news-to-bills.mjs:
--   1. Copy bill_id from policy_alerts where policy_alert_id is set
--   2. Regex-match titles/summaries for bill numbers ("SB 154", "HB 1077"),
--      then verify the state matches before linking
--
-- The index is partial (only non-null rows) to keep it cheap — most
-- news items will remain unlinked (they cover the general kratom
-- conversation, not specific bills).
--
-- Rollback:
--   ALTER TABLE public.news_items DROP COLUMN IF EXISTS bill_id;

ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS news_items_bill_id_idx
  ON public.news_items (bill_id)
  WHERE bill_id IS NOT NULL;

-- Track when we last attempted to correlate a row — lets the backfill
-- script skip rows it already evaluated and found unmatchable. Without
-- this we'd re-process every news item every cron tick.
ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS bill_correlation_attempted_at timestamptz;

CREATE INDEX IF NOT EXISTS news_items_bill_correlation_pending_idx
  ON public.news_items (published_at DESC)
  WHERE bill_correlation_attempted_at IS NULL AND active = true;

COMMENT ON COLUMN public.news_items.bill_id IS
  'Direct link to the bill this article covers, when one can be identified by bill-number regex match + state match. See scripts/correlate-news-to-bills.mjs.';

COMMENT ON COLUMN public.news_items.bill_correlation_attempted_at IS
  'When the bill-correlation matcher last ran on this row, regardless of outcome. NULL = pending. Set to now() on every pass so we do not reprocess unmatchable rows.';

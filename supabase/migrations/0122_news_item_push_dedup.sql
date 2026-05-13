-- 0122: per-news-item push dedup column.
--
-- A pipeline already pushes critical policy_alerts. But news_items
-- that haven't been promoted to alerts can ALSO be high-relevance
-- and state-specific (e.g. a story about a state senator opposing
-- kratom in a candidate forum). Those deserve a state-scoped push
-- separate from the policy_alerts pipeline.
--
-- This column marks news_items already fanned out so the cron job
-- doesn't re-push on every tick.
--
-- Rollback:
--   ALTER TABLE news_items DROP COLUMN IF EXISTS auto_pushed_at;
--   ALTER TABLE news_items DROP COLUMN IF EXISTS auto_pushed_count;

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS auto_pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pushed_count int;

COMMENT ON COLUMN news_items.auto_pushed_at IS
  'When the state-news push cron fanned this item to in-state users. NULL = never pushed.';

CREATE INDEX IF NOT EXISTS ix_news_items_unpushed_high_relevance
  ON news_items (published_at DESC)
  WHERE auto_pushed_at IS NULL
    AND ai_relevance_score >= 0.85
    AND body_has_kratom_keyword IS DISTINCT FROM FALSE;

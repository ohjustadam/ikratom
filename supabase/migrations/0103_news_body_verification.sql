-- 0103: News false-positive defense via article-body verification.
--
-- Problem: Google News RSS returns articles whose source page contains
-- the keyword anywhere — including related-stories sidebars, footers,
-- and recirculation widgets. An article about an Alaska election trial
-- can appear in our `kratom Alaska` query results because the source
-- publication's sidebar happens to link to a kratom story.
--
-- Defense: after sync, fetch each article and check whether a kratom
-- keyword appears in the EXTRACTED MAIN BODY (not the full page text).
-- Items where no keyword shows up in the body are flagged as false
-- positives and filtered from public surfaces.
--
-- Backfill: existing items get processed by the next scheduled run of
-- scripts/verify-news-body.mjs. Until then they keep their current
-- visibility (no display regression).
--
-- Rollback:
--   ALTER TABLE news_items
--     DROP COLUMN IF EXISTS body_verified_at,
--     DROP COLUMN IF EXISTS body_has_kratom_keyword,
--     DROP COLUMN IF EXISTS body_extract_excerpt;
--   DROP INDEX IF EXISTS idx_news_items_body_verified_pending;

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS body_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS body_has_kratom_keyword boolean,
  ADD COLUMN IF NOT EXISTS body_extract_excerpt text;

COMMENT ON COLUMN news_items.body_verified_at IS
  'When the article body fetch+extraction last ran. NULL = pending verification.';
COMMENT ON COLUMN news_items.body_has_kratom_keyword IS
  'TRUE  = a kratom keyword (kratom / mitragynine / 7-OH / gas-station drugs / tianeptine) appears in the extracted main body. '
  'FALSE = body fetched but no keyword found = LIKELY FALSE POSITIVE (article matched Google News only via sidebar/recirculation). '
  'NULL  = not yet verified.';
COMMENT ON COLUMN news_items.body_extract_excerpt IS
  'First ~500 chars of the extracted main body — kept for human audit so admins can see WHY an item was flagged FP. '
  'Not displayed to end users.';

-- Index for the verifier worker: cheap lookup of pending items, ordered
-- by recency (verify newest first so /pulse stays clean as items land).
CREATE INDEX IF NOT EXISTS idx_news_items_body_verified_pending
  ON news_items (published_at DESC NULLS LAST)
  WHERE body_verified_at IS NULL AND active = true;

-- Index for the display layer: filter out FPs fast.
CREATE INDEX IF NOT EXISTS idx_news_items_body_verified_passing
  ON news_items (ai_relevance_score DESC, published_at DESC)
  WHERE body_has_kratom_keyword IS NOT FALSE AND active = true;

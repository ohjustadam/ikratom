-- 0104: Add resolved_url column for Phase 2 body verification.
--
-- Every URL we store today is a Google News redirect:
--   https://news.google.com/rss/articles/CBM...
-- Google uses client-side JS for the actual redirect, so plain
-- fetch(url, {redirect:"follow"}) returns the Google landing page,
-- not the publisher article.
--
-- Phase 2 uses Playwright (real Chromium) to follow the JS redirect
-- and capture the final publisher URL. We cache that resolution in
-- news_items.resolved_url so we only pay the browser cost once per
-- article. Subsequent body fetches can use plain HTTP against the
-- resolved URL.
--
-- resolved_url IS NULL → not yet resolved (Phase 2 worker hasn't
--   processed it, or original URL wasn't a Google News redirect)
-- resolved_url IS NOT NULL → publisher URL ready for HTTP body fetch
--
-- Rollback:
--   ALTER TABLE news_items DROP COLUMN IF EXISTS resolved_url;
--   ALTER TABLE news_items DROP COLUMN IF EXISTS resolved_at;
--   DROP INDEX IF EXISTS idx_news_items_resolve_pending;

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS resolved_url text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

COMMENT ON COLUMN news_items.resolved_url IS
  'Publisher URL after following Google News JS redirect. NULL = not yet resolved by Playwright worker.';
COMMENT ON COLUMN news_items.resolved_at IS
  'When Playwright last attempted to resolve the redirect. Set even on failure so we do not retry every cron run.';

-- Index for the resolver worker — pull most-recent unresolved items
-- first so /pulse gets the freshest signal verified quickest.
CREATE INDEX IF NOT EXISTS idx_news_items_resolve_pending
  ON news_items (published_at DESC NULLS LAST)
  WHERE resolved_at IS NULL AND active = true AND url ~* 'news\.google\.com';

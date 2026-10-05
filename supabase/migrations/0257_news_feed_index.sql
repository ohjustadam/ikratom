-- 0257_news_feed_index.sql
--
-- INTENT: give the all-states news feed an index that matches its sort.
--
-- Fourth-most expensive statement in the database over the 77-day pg_stat
-- window: 810 seconds across 513 calls (1,579 ms mean). It is also the slowest
-- USER-FACING read on the platform — this is the /news list. Shape:
--
--   WHERE active = $1
--     AND duplicate_of IS NULL
--     AND body_has_kratom_keyword IS NOT FALSE
--     AND body_extracted_at IS NOT NULL
--   ORDER BY published_at DESC NULLS LAST
--   LIMIT $2 OFFSET $3
--
-- news_items already carries sixteen indexes and not one serves this. The
-- closest, `idx_news_items_body_verified_passing`, is
-- (ai_relevance_score DESC, published_at DESC) WHERE body_has_kratom_keyword IS
-- NOT FALSE AND active — so it leads on the WRONG column for this ORDER BY, and
-- covers neither `duplicate_of IS NULL` nor `body_extracted_at IS NOT NULL`.
-- The planner used it anyway for the two predicates it does cover, then
-- filtered and sorted the remainder:
--
--   before   Index Scan using idx_news_items_body_verified_passing
--            Filter: (duplicate_of IS NULL AND body_extracted_at IS NOT NULL)
--            rows=7725 scanned to return 30
--            -> Sort (top-N heapsort, Key: published_at DESC NULLS LAST)
--            Buffers: shared hit=11489, Execution Time: 3406.194 ms
--
-- 11,489 buffers and a 7,725-row scan to produce one page of thirty.
--
-- `published_at DESC NULLS LAST` is the only key, matching the ORDER BY exactly
-- so the sort node disappears and OFFSET paging walks the index instead of
-- re-sorting the whole qualifying set per page. All four filters move into the
-- partial predicate, which also keeps the index small — it covers only rows that
-- can ever appear in the feed.
--
-- The predicate is written `body_has_kratom_keyword IS NOT FALSE`, which is how
-- Postgres normalises the query's `NOT ... IS FALSE`, so the planner can match
-- it. (Same form as the existing body_verified_passing index, which is already
-- being chosen by this query — proof the partial-vs-parameter match works here:
-- Postgres builds custom plans with values substituted.)
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.ix_news_items_feed;

CREATE INDEX IF NOT EXISTS ix_news_items_feed
  ON public.news_items (published_at DESC NULLS LAST)
  WHERE active = true
    AND duplicate_of IS NULL
    AND body_has_kratom_keyword IS NOT FALSE
    AND body_extracted_at IS NOT NULL;

COMMENT ON INDEX public.ix_news_items_feed IS
  'Serves the all-states /news feed: ORDER BY published_at DESC NULLS LAST with '
  'all four feed filters in the partial predicate. Before this, the query '
  'borrowed idx_news_items_body_verified_passing (keyed on ai_relevance_score), '
  'scanned 7,725 rows and sorted, for 11,489 buffers and 3.4s.';

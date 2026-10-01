-- 0252_news_dedup_indexes.sql
--
-- INTENT: make news_items inserts stop re-scanning the table.
--
-- `INSERT INTO news_items` was the single most expensive statement in the
-- database: 17,981 seconds of execution time across 23,684 calls (759 ms mean)
-- over the 77-day pg_stat window — roughly 68% of all top-query time, and more
-- than the next thirteen statements combined.
--
-- The cost is not the insert. It is the BEFORE INSERT dedup trigger
-- (`news_items_set_duplicate_of`, migration 0080 + later layers), whose two
-- lookups had no usable index:
--
--   Layer 1  resolved_url = new.resolved_url  ... AND duplicate_of IS NULL
--            There is no index on resolved_url at all. `news_items_url_uniq`
--            covers `url`, which is a different column.
--
--   Layer 2  public.normalize_news_title(title) = v_norm
--            A function call on the COLUMN cannot use a plain btree on title,
--            so every insert fell back to the only thing available — a bitmap
--            scan of `duplicate_of IS NULL` (15,364 rows) followed by calling
--            normalize_news_title() on each candidate.
--
-- Measured before this migration, one Layer-2 lookup:
--
--   Bitmap Index Scan on news_items_duplicate_of_idx  -> 15,364 rows
--   Bitmap Heap Scan, Rows Removed by Filter: 13,351
--   Execution Time: 2063.344 ms
--
-- At ~17,918 candidate titles per insert and 23,684 inserts, that is on the
-- order of 4x10^8 normalize_news_title() calls in the window. The function is
-- already declared IMMUTABLE, which is what makes the expression index below
-- legal — no function change is needed.
--
-- Both indexes are PARTIAL on `duplicate_of IS NULL`, matching the trigger's
-- own predicate, so they stay small: they only cover rows that are still
-- dedup candidates. Column order follows the trigger's filter-then-order
-- shape, with `id` last to serve its `(scraped_at, id)` tie-break.
--
-- NOT DONE DELIBERATELY: `news_items_search_tsv_idx` (GIN, 8.4 MB) shows
-- idx_scan = 0 across the full 77-day window and looks like free space. Leave
-- it. It backs live full-text news search via
-- `src/modules/news/actions.ts` -> .textSearch("search_tsv", ...). Zero scans
-- means no user has searched news in 77 days, NOT that the index is dead;
-- dropping it would silently turn that search into a full scan with a
-- tsvector match per row.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.ix_news_items_dedup_title;
--   DROP INDEX IF EXISTS public.ix_news_items_dedup_resolved_url;
-- Dropping these restores the previous behaviour exactly — they are pure
-- read-path accelerators and no code references them by name.

-- Layer 2: normalized-title + state dedup within the 14-day window.
CREATE INDEX IF NOT EXISTS ix_news_items_dedup_title
  ON public.news_items (
    public.normalize_news_title(title),
    (COALESCE(state, '')),
    scraped_at,
    id
  )
  WHERE duplicate_of IS NULL;

-- Layer 1: exact publisher-URL dedup (cross-state syndication).
CREATE INDEX IF NOT EXISTS ix_news_items_dedup_resolved_url
  ON public.news_items (resolved_url, scraped_at, id)
  WHERE duplicate_of IS NULL AND resolved_url IS NOT NULL;

COMMENT ON INDEX public.ix_news_items_dedup_title IS
  'Serves news_items_set_duplicate_of() Layer 2. Expression index on the '
  'IMMUTABLE normalize_news_title(title); without it every insert re-ran that '
  'function over ~13k candidate rows (2.06s measured per lookup).';

COMMENT ON INDEX public.ix_news_items_dedup_resolved_url IS
  'Serves news_items_set_duplicate_of() Layer 1. resolved_url had no index; '
  'news_items_url_uniq covers the different column `url`.';

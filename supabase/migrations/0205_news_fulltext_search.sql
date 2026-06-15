-- 0205_news_fulltext_search.sql
-- Real corpus-wide search for /news.
--
-- Before: /news search was a CLIENT-SIDE filter over only the latest ~250 rows,
-- matching title + summary + source — so it couldn't find older articles and
-- never searched the article BODY. This adds a proper Postgres full-text index
-- over title + AI summary + extracted body (body_paragraphs jsonb array +
-- body_extract_excerpt) so searchNews() can `.textSearch()` the WHOLE corpus
-- (6k+ items), ranked, including body content.
--
-- Immutability (required for a STORED generated column):
--   - to_tsvector(regconfig, text) is IMMUTABLE (the 2-arg form; the 1-arg
--     default-config form is only STABLE — do not use it here).
--   - jsonb_to_tsvector(regconfig, jsonb, jsonb) is IMMUTABLE and pulls the
--     STRING values out of the body_paragraphs jsonb array (body_paragraphs is
--     jsonb, NOT text[], so array_to_string would not work).
--   - tsvector || tsvector concatenation is IMMUTABLE.
-- ADD COLUMN ... GENERATED ... STORED backfills every existing row on apply and
-- is auto-maintained on insert/update (incl. extract-news-content.mjs body writes).
--
-- Rollback:
--   DROP INDEX IF EXISTS news_items_search_tsv_idx;
--   ALTER TABLE public.news_items DROP COLUMN IF EXISTS search_tsv;

ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(body_extract_excerpt, '')
    )
    || jsonb_to_tsvector('english', coalesce(body_paragraphs, '[]'::jsonb), '["string"]')
  ) STORED;

CREATE INDEX IF NOT EXISTS news_items_search_tsv_idx
  ON public.news_items USING gin (search_tsv);

COMMENT ON COLUMN public.news_items.search_tsv IS
  'Full-text search vector over title + summary + body_extract_excerpt + body_paragraphs (string values). Generated/stored; GIN-indexed. Powers /news corpus-wide search via searchNews().';

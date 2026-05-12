-- 0105: One-shot cleanup of news_items.title to strip publisher suffixes.
--
-- Google News RSS appends "- <Publisher Name>" to every title, e.g.:
--   "Idaho Falls weighing all-out kratom ban - Local News 8"
--   "Tupelo joins growing list of Mississippi municipalities banning kratom - WCBI TV"
--
-- The publisher name is already in news_items.source_name, so the
-- "- Publisher" suffix on the title is pure noise. This migration
-- strips it for items where source_name matches the suffix.
--
-- Strategy: match against the trailing "- <source_name>" pattern
-- (allowing whitespace variation). Only updates rows where the suffix
-- is detected — leaves titles that don't match alone. Idempotent.
--
-- Future inserts: sync-news-rss.mjs gets a corresponding code change
-- to strip the suffix at insert time, so the back-fill is one-time.
--
-- Rollback: irreversible (we drop the suffix). Keep a backup before
-- running in dev if you want to A/B compare.

UPDATE news_items
SET title = regexp_replace(
    title,
    -- " - <source_name>" or " · <source_name>" at end of title.
    -- Word-boundary anchored so we don't strip mid-title hyphens.
    -- (regexp_replace doesn't support backreferences in PG, so we
    -- build the pattern from the literal source_name on each row.)
    '\s+[-–—·|]\s+' || regexp_replace(source_name, '[\.\^\$\|\(\)\[\]\{\}\?\*\+\\]', '\\\&', 'g') || '\s*$',
    '',
    ''
  )
WHERE source_name IS NOT NULL
  AND source_name <> ''
  AND length(source_name) >= 3
  -- Only update rows where the suffix exists. Avoids no-op writes
  -- against rows where the publisher already cleans the title themselves.
  AND title ~ ('\s+[-–—·|]\s+' || regexp_replace(source_name, '[\.\^\$\|\(\)\[\]\{\}\?\*\+\\]', '\\\&', 'g') || '\s*$');

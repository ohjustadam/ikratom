-- 0165_news_events_extracted.sql
--
-- Processing marker for scripts/extract-news-events.mjs, which mines
-- already-scraped kratom news articles for FUTURE-dated civic events
-- (council votes, public hearings, comment deadlines) and seeds them
-- into municipal_meetings so they appear on /calendar + fire reminders.
--
-- This complements discover-municipal-meetings.mjs (per-state Gemini
-- grounding search): that finds meetings by searching the web; this
-- catches event dates already stated in news we ingested but that the
-- grounding search may have missed — and ties each to its source article.
--
-- NULL = not yet processed. Set once the extractor has run AI over the
-- article (and inserted any events found).
--
-- Rollback: ALTER TABLE news_items DROP COLUMN events_extracted_at;

ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS events_extracted_at timestamptz;

COMMENT ON COLUMN public.news_items.events_extracted_at IS
  'Set by scripts/extract-news-events.mjs once the article has been mined for future civic events. NULL = not yet processed.';

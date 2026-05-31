-- 0167_news_body_media.sql
--
-- In-app news reading: store a fair-use lead excerpt + embedded media
-- for each article so /news/[id] can show the story (lead paragraphs +
-- YouTube/Vimeo players + images) without bouncing the user to the
-- publisher. scripts/extract-news-content.mjs populates these from the
-- resolved publisher HTML.
--
-- Copyright posture: body_paragraphs holds a LEAD excerpt only (first
-- few paragraphs, capped) — NOT the full article. The reader always
-- links out to the source for the complete piece. Media URLs are the
-- publishers' own embed/CDN URLs (YouTube/Vimeo/article images), shared
-- as intended, never rehosted.
--
-- body_paragraphs: jsonb array of plain-text strings (rendered as React
-- <p> elements — no raw publisher HTML, so no XSS surface).
-- media_urls: jsonb array of { type:'youtube'|'vimeo'|'image', url,
--   embed_url?, video_id?, lead? }.
--
-- Rollback: drop the three columns.

ALTER TABLE public.news_items
  ADD COLUMN IF NOT EXISTS body_paragraphs jsonb,
  ADD COLUMN IF NOT EXISTS media_urls jsonb,
  ADD COLUMN IF NOT EXISTS body_extracted_at timestamptz;

COMMENT ON COLUMN public.news_items.body_paragraphs IS
  'Fair-use lead excerpt: jsonb array of plain-text paragraph strings (capped). NOT the full article — reader links out for the rest.';
COMMENT ON COLUMN public.news_items.media_urls IS
  'jsonb array of embedded media: { type, url, embed_url?, video_id?, lead? }. Publisher embed/CDN URLs, not rehosted.';
COMMENT ON COLUMN public.news_items.body_extracted_at IS
  'Set by scripts/extract-news-content.mjs once the article HTML has been mined for excerpt + media. NULL = not yet processed.';

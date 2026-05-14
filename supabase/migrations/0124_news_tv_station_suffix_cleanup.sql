-- 0124 — strip ` - <TV CALLSIGN>` suffixes from news_items.title
--
-- Migration 0105 already strips ` - <source_name>` suffixes. The 78
-- rows left over have the same shape but the suffix is a US TV
-- callsign (3-4 letters starting with K or W) that doesn't match
-- source_name verbatim — e.g.:
--   "Spokane City Council voted to ban the sale of kratom - KTVB"
--   "Tennessee lawmakers consider sweeping kratom ban ... - WCYB"
--   "Months after FDA calls it an addictive opioid, 7-OH still
--    sold over the counter - WGME"
--
-- US callsign convention: K* west of Mississippi, W* east. Always
-- 3 or 4 letters, sometimes followed by " TV" or "-TV". This pattern
-- matches conservatively to avoid stripping legitimate suffixes
-- (e.g. " - Reuters" still gets handled by 0105 via source_name).
--
-- Rollback: irreversible. The full feed remains in source_url for
-- the row; only the display title is trimmed.

UPDATE news_items
SET title = trim(regexp_replace(
  title,
  '\s*[-–—·|]\s*[WK][A-Z]{2,3}(?:[\s-]+TV)?\s*$',
  '',
  ''
))
WHERE title ~ '\s*[-–—·|]\s*[WK][A-Z]{2,3}(?:[\s-]+TV)?\s*$';

-- Same cleanup for forum_threads.title where news-driven auto-threads
-- inherited the dirty title before the news side was cleaned up.
-- Only runs when the corresponding pattern actually exists, so this
-- is idempotent and a no-op if forum titles are already clean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'forum_threads'
  ) THEN
    UPDATE public.forum_threads
    SET title = trim(regexp_replace(
      title,
      '\s*[-–—·|]\s*[WK][A-Z]{2,3}(?:[\s-]+TV)?\s*$',
      '',
      ''
    ))
    WHERE title ~ '\s*[-–—·|]\s*[WK][A-Z]{2,3}(?:[\s-]+TV)?\s*$';
  END IF;
END $$;

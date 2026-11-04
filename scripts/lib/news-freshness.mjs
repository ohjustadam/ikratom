/**
 * news-freshness.mjs — is a news story still news?
 *
 * classify-news-policy.mjs reads unclassified news newest first. Once the
 * fresh items run out it keeps going into the archive, and every old story it
 * judges an event becomes an alert dated today. In the week of 2026-11-02, 54
 * of 60 new alerts were stories from June to October. The ticker showed them as
 * breaking, and one became a live Florida campaign about a June rule.
 * Its prompt already said "skip reposts older than 14 days", but a model does
 * not follow that rule reliably, so the code enforces it.
 */

/** A story older than this is history, not intel: it never mints an alert. */
export const STALE_NEWS_DAYS = 14;

/** Age in days, or null when the publish date is missing or unreadable. */
export function newsAgeDays(publishedAt, now = Date.now()) {
  const t = publishedAt ? Date.parse(publishedAt) : NaN;
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null;
}

/** True only for a dated story past the window. An undated story is not stale. */
export function isStaleNews(publishedAt, now = Date.now(), days = STALE_NEWS_DAYS) {
  const age = newsAgeDays(publishedAt, now);
  return age != null && age > days;
}

/** The oldest publish date the classifier should pick up by default. */
export function freshNewsFloor(now = Date.now(), days = STALE_NEWS_DAYS) {
  return new Date(now - days * 86_400_000).toISOString();
}

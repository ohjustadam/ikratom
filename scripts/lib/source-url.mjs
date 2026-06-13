/**
 * Clean, citation-safe source URLs for scripts — the .mjs twin of
 * src/lib/source-link.ts (kept in sync; same Google-redirect regex).
 *
 * News is ingested from Google News RSS, whose `url` is almost always a
 * `news.google.com/rss/articles/…` (or `google.com/url?…`) *redirect*, not the
 * publisher URL. Those are unprofessional pasted into a letter to a government
 * official and useless as a citation. scripts/resolve-news-urls.mjs resolves
 * them to news_items.resolved_url — but that runs in the DAILY cron, while
 * classify-news-policy.mjs runs HOURLY, so at classify time resolved_url is
 * usually still null. We therefore NEVER store a bare Google redirect anywhere
 * a human (or an official) will see it: prefer resolved_url, else the raw url
 * only if it's already a real publisher link, else null.
 */

const GOOGLE_REDIRECT = /^https?:\/\/(news\.google\.com|(www\.)?google\.com\/url)/i;

/** Return the URL only if it's a real publisher link — never a Google redirect, never a bare embed. */
export function cleanSourceUrl(raw) {
  if (!raw) return null;
  const u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) return null;
  if (GOOGLE_REDIRECT.test(u)) return null;
  if (/\/embed\//i.test(u)) return null; // video-player URLs aren't a readable source for an official
  return u;
}

/** First citation-safe URL among candidates (pass resolved_url before the raw url). */
export function bestSourceUrl(...candidates) {
  for (const c of candidates) {
    const clean = cleanSourceUrl(c);
    if (clean) return clean;
  }
  return null;
}

/** True when the string contains a Google-News redirect anywhere (for cleaning stored bodies). */
export function isGoogleRedirect(raw) {
  return !!raw && GOOGLE_REDIRECT.test(String(raw).trim());
}

/**
 * Clean, display-ready source attribution for alerts / news items.
 *
 * News is ingested via Gemini's Google-Search grounding, which frequently
 * hands back Google News *redirect* URLs (news.google.com/rss/articles/… or
 * google.com/url?…). Those are ugly in an alert's "read the source" link and
 * outright unprofessional pasted into a letter to a government official. The
 * Phase-2 worker (scripts/resolve-news-urls.mjs) resolves them to the real
 * publisher URL in news_items.resolved_url; we prefer that, and we refuse to
 * surface a bare Google redirect anywhere a human (or an official) will see it.
 */

const GOOGLE_REDIRECT = /^https?:\/\/(news\.google\.com|(www\.)?google\.com\/url)/i;

/** Return the URL only if it's a real publisher link — never a Google redirect. */
export function cleanSourceUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim();
  if (!/^https?:\/\//i.test(u)) return null;
  if (GOOGLE_REDIRECT.test(u)) return null;
  return u;
}

/** First clean URL among candidates (pass resolved_url before the raw url). */
export function bestSourceUrl(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const clean = cleanSourceUrl(c);
    if (clean) return clean;
  }
  return null;
}

/** Human publisher label from a URL host, e.g. "tulsaworld.com". */
export function publisherFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h || null;
  } catch {
    return null;
  }
}

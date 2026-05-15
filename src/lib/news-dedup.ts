/**
 * Pure helpers for deduplicating news_items rows across syndicates.
 *
 * Why this exists:
 * News12 (Bronx / Westchester / Hudson Valley / Long Island / New Jersey),
 * Newsday, AOL.com, MSN, and other syndicators republish the same article
 * under near-identical titles with the outlet name appended. Without
 * dedup, /bills/[id] + /states/[code] news sections show 5-7 copies of
 * the same story.
 *
 * Strategy: normalize the title by stripping the outlet suffix pattern
 * (" - News12 | Long Island" / " — Newsday" etc.), then collapse to one
 * entry per normalized title. Keep the EARLIEST-published copy as the
 * canonical entry — it's usually the originating outlet rather than a
 * syndicator.
 *
 * Pure functions, no DB. Same logic was inlined in /bills/[id]/page.tsx
 * and /states/[code]/page.tsx; this module is the shared implementation.
 */

export type NewsItem = {
  id: string;
  title: string;
  source_name: string | null;
  url: string;
  published_at: string | null;
  summary: string | null;
};

/**
 * Normalize a title for dedup keying. Strips:
 *   - Trailing outlet suffix(es): " - Newsday", " | News12 | Long Island",
 *     " — AOL.com" — applied iteratively because some titles have
 *     multiple segments ("Story - News12 | Bronx" strips to
 *     "Story - News12" first, then "Story" on the next pass).
 *   - Repeated whitespace
 *   - Case
 *
 * Returns the canonical key. Stable for the same article across syndicates.
 */
const OUTLET_SUFFIX_RE = /\s*[-—|]\s*[a-z0-9 .'’&]+$/i;
const MAX_STRIPS = 4; // bail-out for pathological titles; 4 segments covers all observed real cases

export function normalizeNewsTitle(t: string): string {
  let out = t.toLowerCase();
  // Strip outlet suffix(es) iteratively. "News12 | Long Island" looks
  // like one outlet but the regex sees "| Long Island" as one trailing
  // suffix, then " - News12" as the next. Loop until no more match.
  for (let i = 0; i < MAX_STRIPS; i++) {
    const next = out.replace(OUTLET_SUFFIX_RE, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Deduplicate a list of NewsItem rows, keeping the earliest-published
 * copy as canonical. Returns at most `limit` items, sorted newest first.
 *
 * Robust to:
 *   - null published_at (treated as infinitely-late so they lose tiebreaks)
 *   - empty inputs (returns [])
 *   - single-character titles (preserved)
 */
export function dedupNews(items: NewsItem[], limit = 12): NewsItem[] {
  const seen = new Map<string, NewsItem>();
  for (const n of items) {
    const key = normalizeNewsTitle(n.title ?? "");
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, n);
      continue;
    }
    const existingTime = existing.published_at ? new Date(existing.published_at).getTime() : Infinity;
    const newTime = n.published_at ? new Date(n.published_at).getTime() : Infinity;
    if (newTime < existingTime) seen.set(key, n);
  }
  return [...seen.values()]
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
    .slice(0, limit);
}

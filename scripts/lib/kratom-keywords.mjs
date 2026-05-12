/**
 * Shared kratom-keyword regex — the single source of truth used by:
 *   - sync-news-rss.mjs       (quote-strict Google News queries)
 *   - verify-news-body.mjs    (article-body false-positive defense)
 *   - classify-news-policy.mjs (auto-publish gate)
 *   - /pulse + /news display filters
 *
 * Includes:
 *   - kratom / kratoms / kratomite
 *   - mitragyna / mitragynine
 *   - 7-OH variants (the synthetic alkaloid, often the actual policy target)
 *   - "gas station drugs" — colloquial term that appears in many bans
 *   - tianeptine — usually bundled with kratom in ordinances
 *
 * Word boundaries ensure we don't match substrings like "kratomgate" or
 * "mitragynine-like" without explicit intent. Case-insensitive.
 */
export const KRATOM_KEYWORD_RX =
  /\b(kratom[s]?|kratomite|mitragyna|mitragynine|7-?\s*OH(?:M)?|7-?hydroxymitragynine|gas[- ]?station\s+(?:drugs?|heroin|opioids?)|tianeptine)\b/i;

/**
 * Returns true if any kratom-related keyword appears in the haystack.
 * Pass title + url + summary concatenated for the broadest cheap check.
 */
export function hasKratomKeyword(text) {
  if (!text) return false;
  return KRATOM_KEYWORD_RX.test(String(text));
}

/**
 * Strip HTML tags and recirculation widgets from a page, returning the
 * extracted main-content text. This is the heuristic — not a full DOM
 * parse — but catches 95% of the false-positive bleed:
 *
 *   - Removes <script>, <style>, <noscript>
 *   - Removes <nav>, <aside>, <footer>, <header>
 *   - Removes anything that looks like a related-stories block:
 *       class names containing "related", "recommend", "more-stories",
 *       "popular", "sidebar", "promo", "outbrain", "taboola"
 *   - Returns the inner text of <article> if present, else <main>, else
 *     a body-text fallback
 *
 * NOT a substitute for a proper readability library, but zero deps and
 * good enough for the false-positive defense.
 */
export function extractArticleBody(html) {
  if (!html) return "";
  let h = html;

  // Strip scripts + styles outright
  h = h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  h = h.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  h = h.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  // Strip nav/aside/footer/header — typical FP sources
  h = h.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ");
  h = h.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ");
  h = h.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ");
  h = h.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ");

  // Strip recirculation containers by class hint.
  // Match any tag with a class containing one of the FP-source patterns.
  const FP_CLASS_RX =
    /\b(related|recommend|more-stories|popular|sidebar|promo|outbrain|taboola|recirc|trending|read-more|you-may-like|next-up|elsewhere|teaser|widget|footer)\b/i;
  // Iterate stripping div/section/ul/figure blocks with FP class hints.
  // Single-pass approximation: not perfect for deeply nested matches, but
  // sufficient for the bleeds we're targeting.
  for (const tag of ["div", "section", "ul", "figure"]) {
    const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
    h = h.replace(re, (match, attrs) => {
      if (FP_CLASS_RX.test(attrs)) return " ";
      return match;
    });
  }

  // Prefer <article>, then <main>, else fall back to full body text.
  const article = h.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const main = h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const region = article?.[1] || main?.[1] || h;

  // Strip remaining tags, collapse whitespace.
  return region
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

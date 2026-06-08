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

  // Strip recirculation containers by class/id hint. `attrs` below is the
  // whole attribute string, so this matches both class="..." and id="...".
  // The local-TV templates that leak kratom keywords into our body checks
  // (Gray Television/WRDW, USA Today's "Add Topic" rail, heavy.com's
  // newsletter signup, station weather/"download the app"/trending widgets)
  // all live in one of these blocks — a single buried "kratom" link in a
  // "trending stories" rail was flipping body_has_kratom_keyword=true on
  // congressional-maps / plane-crash / NBA-death articles.
  const FP_CLASS_RX =
    /\b(related|recommend(?:ed|ation|ations)?|more-stories|more-from|also-read|also-like|you-may-like|you-might|around-the-web|web-recs?|popular|most-?read|most-?popular|top-?stories|trending|hot-topics?|latest(?:-news)?|headlines|next-up|elsewhere|teaser|widget|sidebar|promo|sponsored|advert(?:isement)?|outbrain|taboola|zergnet|mgid|recirc|newsletter|subscribe|sign-?up|app-?download|download-?app|get-the-app|weather|marquee|ticker|breadcrumbs?|share|social|comments?|disqus|playlist|tags?|topics?|topic-list|footer|header-nav)\b/i;
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

/**
 * Count kratom keyword occurrences in a string. Uses a fresh global regex
 * each call so we never mutate the shared KRATOM_KEYWORD_RX's lastIndex.
 */
export function countKratomHits(text) {
  if (!text) return 0;
  const rx = new RegExp(KRATOM_KEYWORD_RX.source, "gi");
  const m = String(text).match(rx);
  return m ? m.length : 0;
}

// The "lede" = the first few sentences. A subject article names its topic
// up top; a passing mention (or a leaked recirc link) lands deeper. We use
// sentence count (not raw chars) so a one-line mention at the END of a SHORT
// article isn't mistaken for the lede just because the whole article is short.
const LEAD_SENTENCES = 3;
const LEAD_CHARS_CAP = 700;

function ledeOf(body) {
  const s = String(body || "").trim();
  if (!s) return "";
  const sentences = s.split(/(?<=[.!?])\s+/);
  return sentences.slice(0, LEAD_SENTENCES).join(" ").slice(0, LEAD_CHARS_CAP);
}

/**
 * Decide whether kratom (or a tracked relative) is the actual SUBJECT of an
 * article, vs. a passing mention or a keyword leaked from a recirculation
 * widget. This is the gate that separates real kratom-policy news from the
 * "NBA player who happened to face a kratom possession charge" /
 * "congressional-maps article with a kratom link in its trending rail" class
 * of false positive.
 *
 * Deterministic, zero-cost, free-tier-safe (no AI call). Pass the cleaned
 * body from extractArticleBody() for best accuracy; title/summary alone work.
 *
 * Returns:
 *   {
 *     subject:    boolean,   // is kratom the subject?
 *     score:      0.00..1.00,// confidence kratom is the subject
 *     headlineHit:boolean,   // keyword in title/summary
 *     leadHit:    boolean,   // keyword in the article lede
 *     hits:       number,    // total keyword occurrences in body
 *     density:    number,    // hits per 1,000 body words
 *     reason:     string,
 *   }
 */
export function kratomRelevance({ title = "", summary = "", body = "" } = {}) {
  const headlineHit = hasKratomKeyword(title) || hasKratomKeyword(summary);
  const leadHit = hasKratomKeyword(ledeOf(body));
  const hits = countKratomHits(body);
  const words = body ? String(body).trim().split(/\s+/).filter(Boolean).length : 0;
  const density = words ? (hits / words) * 1000 : 0;

  let subject, score, reason;
  if (headlineHit) {
    subject = true; score = 0.95; reason = "kratom named in title/summary";
  } else if (leadHit) {
    subject = true; score = 0.8; reason = "kratom in the article lede";
  } else if (hits >= 3 || (hits >= 2 && density >= 1.5)) {
    // Sustained discussion deeper in the body (e.g. a news-roundup item).
    subject = true; score = 0.7; reason = `kratom discussed repeatedly (${hits} mentions)`;
  } else if (hits >= 1) {
    subject = false; score = 0.3; reason = `passing mention only (${hits} deep mention${hits === 1 ? "" : "s"})`;
  } else {
    subject = false; score = 0; reason = "no kratom keyword in any signal";
  }
  return { subject, score, headlineHit, leadHit, hits, density, reason };
}

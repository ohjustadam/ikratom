/**
 * Shared HTML → candidate-findings extraction. Used by both adapters:
 *
 *   generic_html.mjs       — fetches HTML with fetch() + Chrome headers
 *   playwright_browser.mjs — fetches HTML with a real Chromium browser
 *
 * Both end up with the same "page HTML, find link / heading / row text
 * candidates, dedupe" logic, so it lives here exactly once.
 */

const NAMED_ENTITIES = {
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…",
};

function fromCodePoint(n) {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // WordPress titles arrive as &#8220;cat&#8217;s claw&#8221; (UT DHHS,
    // 2026-10-25), which reached the review queue undecoded.
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&(rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/g, (_, n) => NAMED_ENTITIES[n])
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const label = stripTags(m[2]);
    if (!label || label.length < 4 || label.length > 300) continue;
    if (/^(home|contact|search|login|menu|sitemap|next|prev|back to top)$/i.test(label)) continue;
    const url = absoluteUrl(href, baseUrl);
    if (!url) continue;
    out.push({ title: label, url });
  }
  return out;
}

function extractHeadings(html) {
  const out = [];
  const re = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[2]);
    if (text && text.length >= 4 && text.length <= 300) {
      out.push({ title: text });
    }
  }
  return out;
}

function extractTableRows(html) {
  const out = [];
  const re = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = stripTags(m[1]);
    if (text && text.length >= 8 && text.length <= 500) {
      out.push({ title: text });
    }
  }
  return out;
}

const normText = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const MIN_OVERLAP_CHARS = 20;

// A press release usually appears as a link AND as the heading or table row
// wrapping it. The url-less copy is the same item with no link to read, so it
// is dropped when a link carries its text: the heading is inside the link
// text ("Title" vs "Title October 23, 2026"), or the link text is most of the
// row. A row with much more text than its link (an agenda line that names
// kratom beside a "Notice of Proposed Rule" link) is kept. Until 2026-10-29
// both copies were stored and both alerted (MO AG, 2026-10-25).
function coveredByLink(text, linkTexts) {
  if (text.length < MIN_OVERLAP_CHARS) return false;
  return linkTexts.some((l) =>
    l.length >= MIN_OVERLAP_CHARS &&
    (l.includes(text) || (text.includes(l) && l.length >= 0.6 * text.length))
  );
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${(item.url ?? "").toLowerCase()}|${item.title.toLowerCase().slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  const linkTexts = out.filter((i) => i.url).map((i) => normText(i.title));
  return out.filter((i) => i.url || !coveredByLink(normText(i.title), linkTexts));
}

/**
 * Turn raw HTML into a deduped list of candidate findings. The
 * engine classifies each one for kratom-relevance + severity.
 *
 * Caps at 300 candidates so a runaway page can't flood the table.
 * Strips <script>/<style>/<nav>/<footer> first to reduce chrome noise.
 */
export function extractFindingsFromHtml(html, baseUrl) {
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ");

  const candidates = [
    ...extractLinks(cleaned, baseUrl),
    ...extractHeadings(cleaned),
    ...extractTableRows(cleaned),
  ];

  return dedupe(candidates).slice(0, 300);
}

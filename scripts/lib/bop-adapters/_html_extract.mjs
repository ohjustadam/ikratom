/**
 * Shared HTML → candidate-findings extraction. Used by both adapters:
 *
 *   generic_html.mjs       — fetches HTML with fetch() + Chrome headers
 *   playwright_browser.mjs — fetches HTML with a real Chromium browser
 *
 * Both end up with the same "page HTML, find link / heading / row text
 * candidates, dedupe" logic, so it lives here exactly once.
 */

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${(item.url ?? "").toLowerCase()}|${item.title.toLowerCase().slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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

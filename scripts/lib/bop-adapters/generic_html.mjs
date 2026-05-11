/**
 * Generic HTML adapter — fetches the source URL, extracts every <a>
 * link + heading + table-row text, and returns the union as candidate
 * findings. The engine's keyword classifier filters out the noise.
 *
 * Works for ~70% of BoP pages we've surveyed: pages with a list of
 * meeting links, rule-proposal links, news headlines, etc. State-
 * specific structure that needs per-site selectors lives in its own
 * adapter (scripts/lib/bop-adapters/<state>.mjs).
 *
 * No HTML parser dependency — uses regex extraction so the cron
 * function doesn't pull in cheerio (50KB+) just for this. The regexes
 * are intentionally conservative: only capture text we're confident is
 * a heading or link label, not the entire body.
 */

const UA =
  "Mozilla/5.0 (compatible; iKratom-BopBot/1.0; +https://www.ikratom.org/about)";

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

/** Pull every <a href="…">text</a> as a candidate finding. */
function extractLinks(html, baseUrl) {
  const out = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    const label = stripTags(m[2]);
    if (!label || label.length < 4 || label.length > 300) continue;
    // Skip obvious navigation chrome
    if (/^(home|contact|search|login|menu|sitemap|next|prev|back to top)$/i.test(label)) continue;
    const url = absoluteUrl(href, baseUrl);
    if (!url) continue;
    out.push({ title: label, url });
  }
  return out;
}

/** Pull every <h1>..<h4> as a candidate finding (no URL). */
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

/** Tables often hold agendas — pull each <tr> as a candidate. */
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

/** Dedupe finding candidates by title+url. */
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

export async function scrape({ source }) {
  const url = source.agenda_url;
  if (!url) return [];

  let html;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/html|xhtml|application\/xml/i.test(contentType)) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }
    html = await res.text();
  } catch (e) {
    throw new Error(`fetch failed: ${e?.message ?? e}`);
  }

  // Strip <script> + <style> + <nav> + <footer> blocks so they don't
  // contribute noise candidates.
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ");

  const candidates = [
    ...extractLinks(cleaned, url),
    ...extractHeadings(cleaned),
    ...extractTableRows(cleaned),
  ];

  return dedupe(candidates).slice(0, 300); // cap so a runaway page can't flood
}

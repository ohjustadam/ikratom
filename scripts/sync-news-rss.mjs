#!/usr/bin/env node
/**
 * iKratom — News scraper via Google News RSS.
 *
 * Free, unlimited, no API key, no AI required. Builds a clean queue of
 * kratom-related articles per state. Optional follow-up: `npm run enrich:news`
 * uses local Ollama to summarize + score relevance.
 *
 * Run with:
 *   node --env-file=.env.local scripts/sync-news-rss.mjs              # all
 *   node --env-file=.env.local scripts/sync-news-rss.mjs OK            # one state
 *   node --env-file=.env.local scripts/sync-news-rss.mjs FED           # federal-only
 */

import { createClient } from "@supabase/supabase-js";

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) { console.error("Missing Supabase env"); process.exit(1); }

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a Google News RSS URL for a given query.
 * hl=en-US gl=US ceid=US:en restricts to US English sources.
 */
function rssUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}+when:30d&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Lightweight RSS parser — just the fields we need (item title, link, pubDate, source).
 * Avoids pulling in a full XML library.
 */
function parseRss(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    const sourceMatch = block.match(/<source [^>]*>([\s\S]*?)<\/source>/);
    const source = sourceMatch ? sourceMatch[1] : null;
    if (title && link) {
      items.push({
        title: decodeEntities(title.trim()),
        url: link.trim(),
        published_at: pubDate ? new Date(pubDate).toISOString() : null,
        source_name: source ? decodeEntities(source.trim()) : null,
      });
    }
  }
  return items;
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Resolve Google News redirect URLs to the canonical source URL.
 * Google News links are like: https://news.google.com/rss/articles/CBM... → 302 → real URL
 * We follow once to capture the actual outlet's URL for storage + dedupe.
 */
async function resolveUrl(url) {
  try {
    const res = await fetch(url, { redirect: "follow", method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return res.url || url;
  } catch {
    return url;
  }
}

async function syncScope(scope) {
  const isFed = scope === "FED";
  const stateName = isFed ? null : STATE_NAMES[scope];
  if (!isFed && !stateName) {
    console.log(`  ${scope}: skip (unknown)`);
    return { scope, count: 0 };
  }

  // Multi-query strategy: kratom alone gets a lot of noise, so we add state
  // context for state scopes and use 7-OH variants for federal.
  const queries = isFed
    ? [
        `kratom legislation`,
        `mitragynine FDA`,
        `7-hydroxymitragynine`,
        `kratom Congress bill`,
      ]
    : [
        `kratom ${stateName}`,
        `kratom ban ${stateName}`,
        `kratom bill ${stateName}`,
      ];

  process.stdout.write(`  ${scope}: `);
  const items = new Map(); // url → item (dedupe across queries)

  for (const q of queries) {
    let xml;
    try {
      const res = await fetch(rssUrl(q), { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      xml = await res.text();
    } catch {
      continue;
    }

    for (const item of parseRss(xml)) {
      if (!items.has(item.url)) items.set(item.url, item);
    }
    await sleep(500);
  }

  if (items.size === 0) {
    console.log("0 items");
    return { scope, count: 0 };
  }

  // Resolve redirects so we have real outlet URLs (and dedupe key works long-term)
  const resolved = [];
  for (const item of items.values()) {
    const realUrl = await resolveUrl(item.url);
    resolved.push({ ...item, url: realUrl });
    await sleep(100);
  }

  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);
  const rows = resolved.map((i) => ({
    state: isFed ? null : scope,
    title: cap(i.title, 300),
    summary: null,                       // filled later by enrich:news
    url: cap(i.url, 1000),
    source_name: cap(i.source_name, 100),
    published_at: i.published_at,
    kratom_topic: null,                  // filled later by enrich:news
    ai_relevance_score: 0.5,             // default; enrich:news adjusts
  })).filter((r) => r.url && /^https?:\/\//.test(r.url));

  const { error, data } = await supabase
    .from("news_items")
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.log(`DB ERROR — ${error.message}`);
    return { scope, count: 0, error: error.message };
  }

  const inserted = data?.length ?? 0;
  console.log(`${rows.length} fetched, ${inserted} new`);
  return { scope, count: inserted };
}

// ---------- main ----------
const arg = process.argv[2]?.toUpperCase();
let targets;
if (!arg) {
  targets = ["FED", ...Object.keys(STATE_NAMES)];
} else if (arg === "FED" || STATE_NAMES[arg]) {
  targets = [arg];
} else {
  console.error(`Unknown scope: ${arg}`);
  process.exit(1);
}

console.log(`\nFetching news from Google News RSS for ${targets.length} scope(s)…\n`);
const t0 = Date.now();
const summary = [];
for (const scope of targets) {
  const r = await syncScope(scope);
  summary.push(r);
  await sleep(1000);
}

const total = summary.reduce((a, b) => a + (b.count || 0), 0);
const failed = summary.filter((s) => s.error);
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\n----------------------------------------`);
console.log(`Done in ${elapsed} min — ${total} new articles across ${targets.length} scopes`);
if (failed.length) console.log(`Failed: ${failed.map((f) => f.scope).join(", ")}`);
console.log(`\nNext: run \`npm run enrich:news\` to add AI summaries + relevance scores.`);
process.exit(0);

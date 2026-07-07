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
import { hasKratomKeyword } from "./lib/kratom-keywords.mjs";

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
 * when:1y captures most of 2026 (we filter for 2026-only after fetching).
 */
function rssUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}+when:1y&hl=en-US&gl=US&ceid=US:en`;
}

/**
 * Keep only recent items — current year or last year — so Google News
 * resurfacing a years-old article doesn't pollute the feed. Rolling (no
 * hardcoded year) so it never silently drops everything on Jan 1.
 * Items without a published_at are accepted (Google sometimes omits it).
 */
function isCurrentYear(item) {
  if (!item.published_at) return true;
  const year = new Date(item.published_at).getUTCFullYear();
  return year >= new Date().getUTCFullYear() - 1;
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
  //
  // Keywords are PHRASE-QUOTED ("kratom") so Google News requires the
  // exact word in the article text. Without quotes, Google's fuzzy
  // matcher returns articles where "kratom" appears only in related-
  // stories sidebars. The quote-strict version dramatically cuts false
  // positives. The verify-news-body.mjs script catches what still slips
  // through (sidebars whose link text is the exact word).
  const queries = isFed
    ? [
        `"kratom" legislation`,
        `"mitragynine" FDA`,
        `"7-hydroxymitragynine"`,
        `"kratom" Congress bill`,
      ]
    : [
        `"kratom" "${stateName}"`,
        `"kratom" ban "${stateName}"`,
        `"kratom" bill "${stateName}"`,
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
      if (!isCurrentYear(item)) continue;  // 2026+ only
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

  // Pre-filter false positives at insert time. Google News matches the
  // keyword anywhere on the source page (including sidebars), so an
  // article whose TITLE doesn't mention kratom or related terms is
  // almost certainly an FP. Pre-flagging body_has_kratom_keyword=false
  // means the display layers skip it on day-one — no need to wait for
  // the daily verifier to catch up.
  //
  // Titles WITH a kratom keyword stay NULL (verifier confirms with
  // summary check next). Avoids over-trusting headlines that mention
  // the substance but aren't real policy events.
  const cap = (s, n) => (s ? String(s).slice(0, n).trim() || null : null);
  // Strip the " - <Publisher>" suffix Google News appends to every
  // RSS title. The publisher name lives in source_name; the suffix
  // is pure noise. Matches " - <source>", " · <source>", etc.
  const stripPublisherSuffix = (title, source) => {
    if (!title) return title;
    let out = String(title);
    // Pass 1: strip exact source_name suffix when we have it.
    if (source) {
      const escaped = String(source).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`\\s+[-–—·|]\\s+${escaped}\\s*$`, "i"), "");
    }
    // Pass 2: strip US TV-station-callsign suffixes that Google News
    // appends even when source_name is the aggregator. Pattern matches
    // 3-4 letter callsigns starting with K or W (the US convention),
    // optionally trailed by " TV" or "-TV". Mirrors migration 0124.
    out = out
      .replace(/\s*[-–—·|]\s*[WK][A-Z]{2,3}(?:[\s-]+TV)?\s*$/, "")
      .trim();
    return out;
  };
  const rows = resolved.map((i) => {
    const cleanTitle = stripPublisherSuffix(i.title, i.source_name);
    const titleHasKw = hasKratomKeyword(cleanTitle ?? "");
    return {
      state: isFed ? null : scope,
      title: cap(cleanTitle, 300),
      summary: null,                       // filled later by enrich:news
      url: cap(i.url, 1000),
      source_name: cap(i.source_name, 100),
      published_at: i.published_at,
      kratom_topic: null,                  // filled later by enrich:news
      ai_relevance_score: 0.5,             // default; enrich:news adjusts
      // Pre-flag obvious FPs (no keyword in title). Titles WITH the
      // keyword stay NULL for the verifier to confirm via summary.
      body_has_kratom_keyword: titleHasKw ? null : false,
    };
  }).filter((r) => r.url && /^https?:\/\//.test(r.url));

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
const rawArgs = process.argv.slice(2);
const mmIdx = rawArgs.indexOf("--max-minutes");
// Wall-clock budget. sync-news-rss (~16 min for 52 scopes) is the biggest job in
// the 28-min hourly news-intake step; a Google throttling window can push it past
// the cap → CI cancel with no telemetry → news-enrich + news-actions cascade-skip
// for the hour (the 2026-06-16 2-day-outage class). Stop cleanly + write partial
// telemetry. 0 = unlimited (local/backfill). Uninterrupted-flow hardening 2026-07-06.
const MAX_MINUTES = mmIdx >= 0 ? parseInt(rawArgs[mmIdx + 1] ?? "0") : 0;
const MAX_RUN_MS = MAX_MINUTES > 0 ? MAX_MINUTES * 60_000 : Infinity;
const arg = rawArgs.find((a, i) => a !== "--max-minutes" && i !== mmIdx + 1)?.toUpperCase();
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
let stoppedEarly = false;
for (const scope of targets) {
  if (Date.now() - t0 > MAX_RUN_MS) {
    stoppedEarly = true;
    console.log(`\n⏱ Reached ${MAX_MINUTES}-min budget after ${summary.length}/${targets.length} scopes — stopping so telemetry lands before the CI cap (next hourly run continues).`);
    break;
  }
  const r = await syncScope(scope);
  summary.push(r);
  await sleep(1000);
}

const total = summary.reduce((a, b) => a + (b.count || 0), 0);
const failed = summary.filter((s) => s.error);
const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\n----------------------------------------`);
console.log(`Done in ${elapsed} min — ${total} new articles across ${summary.length}/${targets.length} scopes`);
if (failed.length) console.log(`Failed: ${failed.map((f) => f.scope).join(", ")}`);
console.log(`\nNext: run \`npm run enrich:news\` to add AI summaries + relevance scores.`);

// Best-effort scraper_runs logging so /admin/intel-health can show
// last-success-time + freshness per source. Never blocks success.
try {
  await supabase.from("scraper_runs").insert({
    source: "sync_news_rss",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: stoppedEarly && total > 0 ? "partial" : (failed.length === targets.length ? "error" : (total === 0 ? "empty" : "success")),
    rows_added: total,
    notes: `${summary.length}/${targets.length} scopes${stoppedEarly ? " · stopped at time budget" : ""}${failed.length ? ` · failed: ${failed.map((f) => f.scope).join(",")}` : ""}` || null,
    error_message: failed.length === targets.length ? "all scopes failed" : null,
  });
} catch { /* best-effort */ }

process.exit(0);

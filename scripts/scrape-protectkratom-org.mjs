#!/usr/bin/env node
/**
 * Scrape protectkratom.org state landing pages for current alerts.
 *
 * AKA publishes time-sensitive state-level kratom-policy alerts on
 * each state's protectkratom.org/<state> page (e.g. "Board of
 * Pharmacy issues Emergency ban", "City Council hearing Thursday").
 * They get this intel via direct relationships with regulators +
 * counsel — faster than any public-data pipeline we can build.
 *
 * Strategy: scrape each state page, extract the dated alert blocks
 * + embedded URLs, upsert into policy_alerts as `pending_review`
 * with a stable dedupe_key. Admins review + approve in /admin/intel
 * — approved alerts then fan-out via the existing notification
 * pipeline (push, Discord, email).
 *
 * Idempotent via dedupe_key = sha1(state + slug + first 200 chars of
 * extracted body). Re-runs are no-ops when the page content hasn't
 * changed; new alerts on the page create new pending_review rows.
 *
 * Usage:
 *   node --env-file=.env.local scripts/scrape-protectkratom-org.mjs
 *   node --env-file=.env.local scripts/scrape-protectkratom-org.mjs --state ohio
 *   node --env-file=.env.local scripts/scrape-protectkratom-org.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ONLY_STATE = arg("--state");
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// State pages AKA maintains on protectkratom.org. Each maps a slug
// to the state code + full name we use in our intel.
const STATE_PAGES = [
  { slug: "pennsylvania", state: "PA", label: "Pennsylvania" },
  { slug: "ohio",         state: "OH", label: "Ohio" },
  { slug: "michigan",     state: "MI", label: "Michigan" },
  { slug: "california",   state: "CA", label: "California" },
  { slug: "nevada",       state: "NV", label: "Nevada" },
  { slug: "delaware",     state: "DE", label: "Delaware" },
  { slug: "iowa",         state: "IA", label: "Iowa" },
  { slug: "kentucky",     state: "KY", label: "Kentucky" },
  { slug: "virginia",     state: "VA", label: "Virginia" },
  { slug: "tennessee",    state: "TN", label: "Tennessee" },
  { slug: "illinois",     state: "IL", label: "Illinois" },
  { slug: "minnesota",    state: "MN", label: "Minnesota" },
  { slug: "new-york",     state: "NY", label: "New York" },
  { slug: "west-virginia",state: "WV", label: "West Virginia" },
  { slug: "massachusetts",state: "MA", label: "Massachusetts" },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 iKratomBot/1.0";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function stripHtml(html) {
  // Naive but adequate — we're picking out alert text, not full DOM.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

// Pull every absolute URL we can find in the HTML — these are the
// underlying source documents (BoP rule PDFs, news articles, etc.)
function extractUrls(html) {
  const urls = new Set();
  const re = /href="(https?:\/\/[^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const u = m[1];
    if (u.includes("protectkratom.org")) continue;
    if (u.includes("americankratom.org")) continue;
    if (u.includes("kratomanswers.org")) continue;
    if (u.match(/\.(jpg|png|svg|gif|ico)$/i)) continue;
    urls.add(u);
  }
  return [...urls];
}

// Heuristically pull the "alert block" — the most recent dated
// callout on the page. AKA's pattern is "Month Year: STATE Latest"
// followed by paragraph(s) of bold text. We grab the largest text
// chunk containing a date or month name.
const MONTH_RE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i;
const DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s*\d{4})?|\b\d{1,2}\/\d{1,2}\/\d{2,4}/i;

function extractAlertText(text) {
  // Find the first occurrence of "Month YYYY:" and grab the chunk
  // up to the next double-newline-ish break.
  const monthMatch = text.match(MONTH_RE);
  if (!monthMatch) return null;
  const idx = monthMatch.index;
  if (idx == null) return null;
  // Take up to 1500 chars from the match — typical AKA alert blocks
  // are a few hundred chars; we cap to avoid pulling the whole page.
  const chunk = text.slice(idx, idx + 1500).trim();
  // Trim at common boundary markers
  const stopMarkers = [
    " SIGN-UP FOR FUTURE HEARINGS",
    " Copyright American Kratom Association",
    " Take Action",
    " About Us",
    " Donate",
  ];
  let trimmed = chunk;
  for (const m of stopMarkers) {
    const i = trimmed.indexOf(m);
    if (i > 50) trimmed = trimmed.slice(0, i).trim();
  }
  return trimmed;
}

function classifySeverity(text) {
  const lower = text.toLowerCase();
  // policy_alerts_severity_chk: routine | watch | alert | critical
  if (/\bemergency\b/.test(lower) || /\bban\b/.test(lower) || /\bcriminaliz/.test(lower)) return "critical";
  if (/\bhearing\b/.test(lower) || /\bvote\b/.test(lower) || /\bcommittee\b/.test(lower)) return "alert";
  if (/\bbill\b/.test(lower) || /\blegislation\b/.test(lower)) return "watch";
  return "routine";
}

function classifyKind(text) {
  const lower = text.toLowerCase();
  // Constrained set per policy_alerts_kind_chk:
  //   bill_event | bop_hearing | fda_action | dea_action |
  //   news_break | intel_tip | scraper_stale | briefing_published
  if (/\b(board of pharmacy|bop\b|jcarr|emergency rule|rulemaking)\b/.test(lower)) return "bop_hearing";
  if (/\bfda\b/.test(lower)) return "fda_action";
  if (/\bdea\b/.test(lower)) return "dea_action";
  if (/\b(hearing|committee meeting|vote|bill\s|legislation)\b/.test(lower)) return "bill_event";
  return "news_break";
}

function dedupeKey(state, slug, body) {
  const sig = body.toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  const h = createHash("sha1").update(`pko:${slug}:${sig}`).digest("hex").slice(0, 16);
  return `protectkratom:${state}:${h}`;
}

async function scrapeOne(page) {
  process.stdout.write(`  ${page.label.padEnd(20)} `);
  const url = `https://www.protectkratom.org/${page.slug}`;
  let html;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) { console.log(`HTTP ${r.status}`); return 0; }
    html = await r.text();
  } catch (e) {
    console.log(`fetch fail: ${String(e.message).slice(0, 60)}`);
    return 0;
  }
  const text = stripHtml(html);
  const alertBody = extractAlertText(text);
  if (!alertBody || alertBody.length < 80) {
    console.log(`no dated alert`);
    return 0;
  }
  const urls = extractUrls(html);
  const severity = classifySeverity(alertBody);
  const kind = classifyKind(alertBody);
  const dedupe = dedupeKey(page.state, page.slug, alertBody);

  // Compose policy_alert
  const titleSnippet = alertBody.replace(/\s+/g, " ").slice(0, 140);
  const bodyFull = `${alertBody}\n\nSource: ${url}\nReferenced URLs: ${urls.slice(0, 5).join(", ")}`;
  const row = {
    kind,
    severity,
    title: `[AKA alert] ${page.label}: ${titleSnippet}…`.slice(0, 200),
    body: bodyFull.slice(0, 4000),
    locality: page.state, // policy_alerts_locality_chk requires 2-letter state code
    source_url: url,
    action_required: severity === "critical" || severity === "alert",
    moderation_status: "pending",
    dedupe_key: dedupe,
  };

  if (DRY_RUN) {
    console.log(`would upsert [${severity}/${kind}]: ${titleSnippet.slice(0, 60)}…`);
    return 1;
  }
  // Manual dedupe — check if a row with this dedupe_key already
  // exists. There's no unique constraint on dedupe_key today (it's
  // used by other code paths but not enforced).
  const { data: existing } = await sb
    .from("policy_alerts")
    .select("id")
    .eq("dedupe_key", dedupe)
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(`exists [${severity}/${kind}]`);
    return 0;
  }
  const { error } = await sb.from("policy_alerts").insert(row);
  if (error) {
    console.log(`db fail: ${error.message.slice(0, 80)}`);
    return 0;
  }
  console.log(`✓ NEW [${severity}/${kind}]`);
  return 1;
}

// ── Main
const t0 = Date.now();
const pagesToScan = ONLY_STATE
  ? STATE_PAGES.filter((p) => p.slug === ONLY_STATE.toLowerCase() || p.state.toLowerCase() === ONLY_STATE.toLowerCase())
  : STATE_PAGES;
console.log(`Scraping ${pagesToScan.length} protectkratom.org state page(s)${DRY_RUN ? " (DRY RUN)" : ""}…\n`);
let total = 0;
for (const page of pagesToScan) {
  total += await scrapeOne(page);
  await sleep(1200); // be polite
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${total} alert(s) processed.`);

try {
  await sb.from("scraper_runs").insert({
    source: "scrape_protectkratom_org",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: total,
    notes: `${pagesToScan.length} pages scanned`,
  });
} catch { /* best-effort */ }

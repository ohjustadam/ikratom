/**
 * Extract bill / resolution / ordinance numbers from policy_alerts +
 * news_items and promote them to tracked rows in the bills table.
 *
 * The Suffolk County Resolution 1279-2026 incident (2026-05-14)
 * exposed this gap: we had 11 policy_alerts mentioning the resolution
 * AND a municipal_meetings row for the hearing AND a Newsday article,
 * but NO row in `bills` tracking the resolution itself. We could see
 * the event, but couldn't track the legislation's lifecycle.
 *
 * The fix needs to be GENERAL, not Suffolk-specific. Every state has
 * a different bill-number format:
 *   - State legislatures: "HB 437", "SB 101", "AB 2212"
 *   - NY-style county: "I.R. 1279-2026", "Resolution No. 1279-2026"
 *   - Local ordinances: "Ordinance No. 23-456"
 *   - Federal: "H.R. 7669", "S. 2367"
 *
 * This script scans existing policy_alerts + news_items where active=
 * true and kratom-related, extracts every bill-number pattern, and
 * upserts a row into `bills` when no matching (state, bill_number)
 * already exists.
 *
 * Confidence rules — we only auto-create when:
 *   - The text explicitly contains "Resolution|Ordinance|I.R.|HB|SB|
 *     AB|HCR|HJR|LB|HF|SF" + a number
 *   - The state can be inferred from the alert's locality OR the
 *     news_item's state column
 *   - The same (state, bill_number) isn't already tracked
 *
 * Idempotent — re-running is safe (UPSERT on (state, bill_number)).
 *
 * Usage:
 *   node --env-file=.env.local scripts/extract-bills-from-alerts.mjs
 *   node --env-file=.env.local scripts/extract-bills-from-alerts.mjs --dry-run
 *   node --env-file=.env.local scripts/extract-bills-from-alerts.mjs --limit 100
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };

const DRY_RUN = flag("--dry-run");
const LIMIT = parseInt(arg("--limit", "500"), 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Bill-number patterns. Each is a regex that captures the number
// and tells us the scope. We try them in priority order — the most
// specific pattern wins for any given text.
//
// IMPORTANT: each pattern must be specific enough to avoid false
// positives. "HB 23" is a real bill format but also a chemistry
// term; we require word-boundary + space + number to be confident.
// =============================================================
const PATTERNS = [
  // NY county-style "I.R. 1234-2026" or "I.R. 1234"
  { re: /\bI\.?\s*R\.?\s+(\d{2,5}(?:[-/]\d{4})?)\b/g, scope: "county", prefix: "I.R." },
  // "Resolution No. 1234-2026" / "Resolution No. 1234" / "Res. No. 1234"
  { re: /\bResolution\s+(?:No\.?|Number)\s+(\d{2,5}(?:[-/]\d{4})?)\b/gi, scope: "municipal", prefix: "Resolution" },
  // "Ordinance No. 23-456"
  { re: /\bOrdinance\s+(?:No\.?|Number)\s+(\d{1,4}[-/]\d{1,4})\b/gi, scope: "municipal", prefix: "Ordinance" },
  // State-legislature classic: "HB 437" / "SB 101" / "AB 2212" / "HCR 14" / "HJR 5" / "LB 230" / "HF 1234" / "SF 5678"
  //
  // We deliberately DON'T include a federal "H.R. 1234" / "S. 1234"
  // pattern here. Federal bills are sourced via Senate LDA + Congress.gov
  // (when we add it); trying to regex-extract them from state news
  // causes false positives like "U.S. 7-O Kratom Bust" → "S. 7".
  // For state-level use, we require 1-5 digit numbers with prefix
  // word boundary on both sides.
  { re: /\b(HB|SB|AB|AS|HCR|SCR|HJR|SJR|LB|HF|SF|HR|H\.B\.|S\.B\.)\s+(\d{1,5})\b/g, scope: "state", prefix: null /* matched group is the prefix */ },
];

const KRATOM_RE = /kratom|mitragyn|7[ -]?oh|7-?hydroxymitragynine/i;

/**
 * Pull the state code from a policy_alerts.locality string.
 * Formats we see: "NY" / "Suffolk County, NY" / "Marshall, IL" /
 * "Nassau County, NY" / "ALL" (skip federal-bucketed)
 */
function stateFromLocality(loc) {
  if (!loc) return null;
  const trimmed = loc.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/,\s*([A-Z]{2})\s*$/);
  if (m) return m[1];
  return null;
}

/**
 * Extract county/city name from locality when present.
 * "Suffolk County, NY" → "Suffolk County, NY"
 * "Marshall, IL" → "Marshall, IL"
 * "NY" → null (state-only, no specific locality)
 */
function localityFromText(loc) {
  if (!loc) return null;
  const trimmed = loc.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return null;
  if (trimmed.includes(",")) return trimmed;
  return null;
}

/**
 * Run all patterns against text. Returns array of
 * { billNumber, scope, prefix } matches. Dedupes within one text.
 */
function extractBillNumbers(text) {
  if (!text) return [];
  const found = new Map();
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const num = m[m.length - 1];
      const prefix = p.prefix ?? m[1];
      // Skip placeholder/sample bill numbers like "SB 0000" or "HB 0"
      // — these are template artifacts that show up in news templates
      // and trigger false positives.
      const numericPart = num.split(/[-/]/)[0];
      if (/^0+$/.test(numericPart)) continue;
      const billNumber = `${prefix} ${num}`.trim();
      const key = billNumber.toUpperCase().replace(/\s+/g, " ");
      if (!found.has(key)) {
        found.set(key, { billNumber, scope: p.scope, prefix });
      }
    }
  }
  return [...found.values()];
}

/**
 * Build a bills row from an extraction.
 */
function rowFromExtraction(state, ex, sourceUrl, sourceContext) {
  return {
    state,
    bill_number: ex.billNumber,
    title: `[${state}] ${ex.billNumber} — auto-extracted from kratom-related coverage`,
    summary: sourceContext ? `Auto-extracted from coverage. Original context: "${sourceContext.slice(0, 400)}"` : null,
    status: "introduced",
    last_action: null,
    last_action_at: null,
    kratom_relevance: "anti",  // default conservative; admin can flip to neutral if it's a pro-kratom bill
    relevance_confidence: 0.6,  // medium — we matched a pattern but didn't read full text
    source_url: sourceUrl,
    scope: ex.scope,
    locality: null,  // filled by caller when available
    active: true,
    session_id: null,
    targets_natural_leaf: null,
    targets_synthetic_only: null,
    created_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
  };
}

// =============================================================
// Main
// =============================================================
const t0 = Date.now();
console.log(`Extracting bills from policy_alerts + news_items${DRY_RUN ? " (DRY RUN)" : ""}…`);

// Pull existing (state, bill_number) keys so we don't re-create
// already-tracked bills. Lowercase for comparison.
const { data: existingBills } = await sb
  .from("bills")
  .select("state, bill_number")
  .range(0, 9999);
const existingKeys = new Set();
for (const b of existingBills ?? []) {
  if (b.state && b.bill_number) {
    existingKeys.add(`${b.state}|${b.bill_number.toUpperCase().replace(/\s+/g, " ").trim()}`);
  }
}
console.log(`  ${existingKeys.size} existing (state, bill_number) keys`);

// Pull policy_alerts — these have explicit locality + are kratom-tagged.
const { data: alerts } = await sb
  .from("policy_alerts")
  .select("id, title, body, locality, source_url, created_at")
  .eq("moderation_status", "approved")
  .order("created_at", { ascending: false })
  .limit(LIMIT);
console.log(`  ${alerts?.length ?? 0} approved policy_alerts to scan`);

// Pull news_items — title + summary + body_extract_excerpt, state column.
const { data: news } = await sb
  .from("news_items")
  .select("id, title, summary, body_extract_excerpt, state, url, published_at")
  .eq("active", true)
  .not("body_has_kratom_keyword", "is", false)
  .order("published_at", { ascending: false })
  .limit(LIMIT);
console.log(`  ${news?.length ?? 0} active body-verified news_items to scan`);

const toCreate = new Map(); // key: state|bill_number, value: row
let scannedAlerts = 0, scannedNews = 0, alreadyTracked = 0;

// Scan alerts
for (const a of alerts ?? []) {
  scannedAlerts++;
  const state = stateFromLocality(a.locality);
  if (!state) continue;
  const text = `${a.title ?? ""} ${a.body ?? ""}`;
  if (!KRATOM_RE.test(text)) continue;
  const extractions = extractBillNumbers(text);
  for (const ex of extractions) {
    const key = `${state}|${ex.billNumber.toUpperCase().replace(/\s+/g, " ")}`;
    if (existingKeys.has(key)) { alreadyTracked++; continue; }
    if (toCreate.has(key)) continue;
    const row = rowFromExtraction(state, ex, a.source_url, text.slice(0, 400));
    row.locality = localityFromText(a.locality);
    toCreate.set(key, row);
  }
}

// Scan news
for (const n of news ?? []) {
  scannedNews++;
  if (!n.state) continue;
  const text = `${n.title ?? ""} ${n.summary ?? ""} ${n.body_extract_excerpt ?? ""}`;
  if (!KRATOM_RE.test(text)) continue;
  const extractions = extractBillNumbers(text);
  for (const ex of extractions) {
    const key = `${n.state}|${ex.billNumber.toUpperCase().replace(/\s+/g, " ")}`;
    if (existingKeys.has(key)) { alreadyTracked++; continue; }
    if (toCreate.has(key)) continue;
    const row = rowFromExtraction(n.state, ex, n.url, text.slice(0, 400));
    toCreate.set(key, row);
  }
}

const rows = [...toCreate.values()];
console.log(`\nScanned: ${scannedAlerts} alerts + ${scannedNews} news items`);
console.log(`Already tracked (matched): ${alreadyTracked}`);
console.log(`New bills to create: ${rows.length}`);

if (rows.length > 0) {
  console.log(`\nNew bills (first 15):`);
  for (const r of rows.slice(0, 15)) {
    console.log(`  [${r.state}] ${r.bill_number}${r.locality ? ` · ${r.locality}` : ""} — ${r.source_url?.slice(0, 80)}`);
  }
}

if (DRY_RUN || rows.length === 0) {
  console.log(`\n${DRY_RUN ? "DRY RUN — skipping insert." : "Nothing to write."}`);
  process.exit(0);
}

// Insert with onConflict=ignore so re-runs don't fail. (We already
// dedupe vs existingKeys, but a parallel scraper could race.)
const BATCH = 100;
let written = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const { error, data } = await sb
    .from("bills")
    .upsert(chunk, { onConflict: "state,bill_number", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error(`  Batch ${i / BATCH} failed: ${error.message?.slice(0, 200)}`);
    continue;
  }
  written += data?.length ?? 0;
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${written} bills auto-extracted + created.`);

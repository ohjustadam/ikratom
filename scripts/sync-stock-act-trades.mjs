/**
 * Sync federal legislator personal-trade disclosures (STOCK Act PTRs)
 * from Senate Stock Watcher + House Stock Watcher.
 *
 * Senate source: github.com/timothycarambat/senate-stock-watcher-data
 *   - all_transactions.json: aggregate of every Senate PTR row
 *   - As of probe (2026-05-14): 8,350 transactions
 *
 * House source: house-stock-watcher-data S3 bucket
 *   - all_transactions.json
 *   - Status: 403 on some days; we'll attempt + log when blocked
 *
 * Why we care for kratom specifically: a federal legislator who owns
 * pharma stock (e.g. an opioid manufacturer) while voting on kratom
 * legislation has a documentable conflict signal. The Mullin-Botanic-
 * Tonics pattern is the prototype — federal-level lawmakers with
 * direct or family financial exposure to kratom-adjacent industries
 * influence how they vote on rules + scheduling. PTRs are the only
 * public lens into that exposure.
 *
 * Idempotency: UNIQUE(chamber, legislator_name, ticker,
 * transaction_date, transaction_type, amount_range, owner). Re-runs
 * upsert. Each batch is small (Senate fits comfortably in memory).
 *
 * Kratom-adjacency tagging is conservative: a small known list of
 * tickers + name patterns. Admin / editorial can flag more rows
 * later via SQL update.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-stock-act-trades.mjs
 *   node --env-file=.env.local scripts/sync-stock-act-trades.mjs --senate-only
 *   node --env-file=.env.local scripts/sync-stock-act-trades.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const DRY_RUN = flag("--dry-run");
const SENATE_ONLY = flag("--senate-only");
const HOUSE_ONLY = flag("--house-only");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const USER_AGENT = "iKratom-policy-monitor/1.0 (contact: ohjustadam@proton.me)";
const SENATE_URL = "https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_transactions.json";
const HOUSE_URL = "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json";

// =============================================================
// Kratom-adjacent industry tickers + name patterns. Conservative —
// includes opioid manufacturers (Endo, Indivior, Reckitt), addiction
// treatment firms (BioCorRx), known kratom-vendor parent companies
// (when public), and broad pharma giants where opioid product lines
// are major business (Pfizer, Merck, Teva, Mallinckrodt). Editorial
// admin can broaden via SQL update.
// =============================================================
const KRATOM_ADJACENT_TICKERS = new Set([
  // Direct opioid manufacturers / settlements
  "ENDP", "ENDO", "INDV", "RBGLY", "TEVA", "MNK", "PRGO",
  // Pharma giants with major opioid + addiction exposure
  "PFE", "MRK", "ABBV", "JNJ", "BMY",
  // Addiction treatment / recovery
  "ACAD", "ALKS", "BCRX",
  // Tobacco / nicotine — substance-adjacent regulatory overlap
  "PM", "MO", "BTI",
  // Cannabis (similar regulatory dynamics)
  "TLRY", "CGC", "ACB", "CRON", "GTBIF", "CURLF",
]);

const KRATOM_ADJACENT_NAME_RE = /endo|indivior|reckitt|teva|mallinckrodt|purdue|opioid|naloxone|suboxone|methadone|kratom/i;

function classifyKratomAdjacency(ticker, assetDescription) {
  const t = (ticker || "").toUpperCase();
  if (t && KRATOM_ADJACENT_TICKERS.has(t)) {
    return { is: true, note: `Ticker ${t} flagged as kratom-adjacent (pharma/addiction/substance-policy overlap).` };
  }
  if (KRATOM_ADJACENT_NAME_RE.test(assetDescription || "")) {
    return { is: true, note: `Asset description matches kratom-adjacent industry pattern.` };
  }
  return { is: false, note: null };
}

// =============================================================
// Parse amount range like "$50,001 - $100,000" → { lower: 50001, upper: 100000 }
// =============================================================
function parseAmountRange(s) {
  if (!s) return { lower: null, upper: null };
  const numbers = (s.match(/\$([0-9,]+)/g) || []).map(n => Number(n.replace(/[$,]/g, "")));
  if (numbers.length === 0) return { lower: null, upper: null };
  if (numbers.length === 1) return { lower: numbers[0], upper: numbers[0] };
  return { lower: numbers[0], upper: numbers[numbers.length - 1] };
}

// =============================================================
// Parse "MM/DD/YYYY" or "YYYY-MM-DD"
// =============================================================
function parseDate(s) {
  if (!s) return null;
  const trimmed = String(s).trim();
  // YYYY-MM-DD
  let m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // MM/DD/YYYY
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

// =============================================================
// Map a Senate Stock Watcher row → our schema row
// =============================================================
function toSenateRow(r) {
  const amt = parseAmountRange(r.amount);
  const adj = classifyKratomAdjacency(r.ticker, r.asset_description);
  return {
    source: "senate_stock_watcher",
    chamber: "senate",
    ptr_link: r.ptr_link ?? null,
    ptr_uuid: r.ptr_link ? (r.ptr_link.match(/ptr\/([a-f0-9-]+)/i)?.[1] ?? null) : null,
    legislator_name: (r.senator ?? "").slice(0, 200),
    legislator_id: null,                                  // resolved in a separate pass below
    owner: r.owner ?? null,
    ticker: r.ticker ?? null,
    asset_description: (r.asset_description ?? "(unknown asset)").slice(0, 500),
    asset_type: r.asset_type ?? null,
    transaction_date: parseDate(r.transaction_date),
    filing_date: parseDate(r.disclosure_date),
    transaction_type: r.type ?? null,
    amount_range: r.amount ?? null,
    amount_lower: amt.lower,
    amount_upper: amt.upper,
    comment: r.comment ?? null,
    is_kratom_adjacent: adj.is,
    kratom_relevance_note: adj.note,
    raw_json: r,
    synced_at: new Date().toISOString(),
  };
}

// =============================================================
// House Stock Watcher row shape is similar but uses different field names
// =============================================================
function toHouseRow(r) {
  const amt = parseAmountRange(r.amount);
  const adj = classifyKratomAdjacency(r.ticker, r.asset_description);
  return {
    source: "house_stock_watcher",
    chamber: "house",
    ptr_link: r.ptr_link ?? null,
    ptr_uuid: r.disclosure_id ?? null,
    legislator_name: (r.representative ?? r.senator ?? "").slice(0, 200),
    legislator_id: null,
    owner: r.owner ?? null,
    ticker: r.ticker ?? null,
    asset_description: (r.asset_description ?? "(unknown asset)").slice(0, 500),
    asset_type: r.asset_type ?? null,
    transaction_date: parseDate(r.transaction_date),
    filing_date: parseDate(r.disclosure_date),
    transaction_type: r.type ?? null,
    amount_range: r.amount ?? null,
    amount_lower: amt.lower,
    amount_upper: amt.upper,
    comment: r.comment ?? null,
    is_kratom_adjacent: adj.is,
    kratom_relevance_note: adj.note,
    raw_json: r,
    synced_at: new Date().toISOString(),
  };
}

// =============================================================
// Fetch + parse one chamber's data
// =============================================================
async function fetchChamber(url, transform, label) {
  process.stdout.write(`  ${label}… `);
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    console.log(`network fail: ${String(e.message).slice(0, 100)}`);
    return [];
  }
  if (!res.ok) {
    console.log(`HTTP ${res.status} — source unavailable`);
    return [];
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.log(`JSON parse fail: ${String(e.message).slice(0, 80)}`);
    return [];
  }
  if (!Array.isArray(data)) {
    console.log(`unexpected shape (not array)`);
    return [];
  }
  const rows = data.map(transform).filter(r => r.legislator_name && r.asset_description);
  console.log(`${rows.length} trades parsed`);
  return rows;
}

// =============================================================
// Match legislator_name to legislators.full_name. Best-effort — many
// won't match (different name forms). Unmatched rows keep
// legislator_id NULL.
// =============================================================
async function resolveLegislatorIds(rows) {
  const names = new Set();
  for (const r of rows) names.add(r.legislator_name.toLowerCase().trim());
  if (names.size === 0) return rows;
  const { data: legs } = await sb
    .from("legislators")
    .select("id, full_name")
    .in("role", ["us_senate", "us_house"])
    .eq("active", true);
  const byName = new Map();
  for (const l of legs ?? []) {
    if (!l.full_name) continue;
    byName.set(l.full_name.toLowerCase().trim(), l.id);
    // Also try "First Last" forms — Senate Stock Watcher sometimes uses
    // "Ron L Wyden" with middle initial; map that to "Ron Wyden" too.
    const parts = l.full_name.split(/\s+/);
    if (parts.length >= 2) {
      byName.set(`${parts[0].toLowerCase()} ${parts[parts.length - 1].toLowerCase()}`, l.id);
    }
  }
  let matched = 0;
  for (const r of rows) {
    const n = r.legislator_name.toLowerCase().trim();
    let id = byName.get(n);
    if (!id) {
      // Try first-last only
      const parts = n.split(/\s+/);
      if (parts.length >= 2) {
        id = byName.get(`${parts[0]} ${parts[parts.length - 1]}`);
      }
    }
    if (id) { r.legislator_id = id; matched++; }
  }
  console.log(`  resolved ${matched}/${rows.length} legislator_id matches`);
  return rows;
}

// =============================================================
// Main
// =============================================================
const t0 = Date.now();
console.log(`Syncing STOCK Act trades${DRY_RUN ? " (DRY RUN)" : ""}…`);

const allRows = [];
if (!HOUSE_ONLY) {
  const senate = await fetchChamber(SENATE_URL, toSenateRow, "Senate Stock Watcher");
  allRows.push(...senate);
}
if (!SENATE_ONLY) {
  const house = await fetchChamber(HOUSE_URL, toHouseRow, "House Stock Watcher");
  allRows.push(...house);
}

if (allRows.length === 0) {
  console.log("\nNo rows. Done.");
  process.exit(0);
}

await resolveLegislatorIds(allRows);

const kratomAdjacent = allRows.filter(r => r.is_kratom_adjacent);
console.log(`\nKratom-adjacent trades: ${kratomAdjacent.length}/${allRows.length}`);
for (const r of kratomAdjacent.slice(0, 15)) {
  const amtFmt = r.amount_lower ? `$${r.amount_lower.toLocaleString()}-$${r.amount_upper.toLocaleString()}` : r.amount_range;
  console.log(`  ${r.transaction_date} · ${r.legislator_name.padEnd(28)} · ${r.transaction_type ?? "?"} · ${r.ticker ?? "?"} (${r.asset_description?.slice(0, 30)}) ${amtFmt}`);
}

if (DRY_RUN) {
  console.log("\nDRY RUN — skipping insert.");
  process.exit(0);
}

// Upsert in batches. Some upstream rows are exact duplicates (same
// legislator, same trade, multiple PTRs); the UNIQUE constraint
// handles those. We use ignoreDuplicates=true so repeats are
// silently skipped.
const BATCH = 200;
let written = 0;
for (let i = 0; i < allRows.length; i += BATCH) {
  const chunk = allRows.slice(i, i + BATCH);
  const { error, data } = await sb
    .from("federal_personal_trades")
    .upsert(chunk, {
      onConflict: "chamber,legislator_name,ticker,transaction_date,transaction_type,amount_range,owner",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) {
    console.error(`  Batch ${i / BATCH} failed: ${error.message?.slice(0, 200)}`);
    continue;
  }
  written += data?.length ?? 0;
  if (i % (BATCH * 10) === 0 && i > 0) console.log(`    …${written}/${allRows.length} written`);
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${written} new trade rows written.`);

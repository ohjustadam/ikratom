/**
 * Utah state lobbyist registry scraper (Phase 3 D2 pilot).
 *
 * Pulls every lobbyist↔principal registration from
 * https://lobbyist.utah.gov/Search/LobbyistByPrincipal — a single
 * HTML page that lists all currently and historically registered
 * Utah lobbyists with their principals (clients), addresses, and
 * registration dates.
 *
 * What we capture per row:
 *   - Lobbyist name (normalized from "Last, First" → "First Last")
 *   - Registration type ('Principal' = directly-paid representative,
 *     'Business' = registered firm — Utah duplicates some lobbyists
 *     across both)
 *   - Principal (the hiring entity, e.g. "American Kratom Association")
 *   - Principal address / phone (for cross-reference with the federal
 *     LDA filings — addresses change when shells reorganize)
 *   - Start / end dates (end_date NULL = currently active)
 *
 * Kratom-relevance filter: we flag rows where the principal name
 * matches our kratom-industry pattern. ALL rows are upserted (so we
 * can re-classify later without re-scraping) but only flagged rows
 * are surfaced in the briefing.
 *
 * Currently flagged Utah principals as of 2026-05-14:
 *   - American Kratom Association — 6 active lobbyists (a Jan 2026
 *     hiring burst of Salmon, White, Clyde on top of long-standing
 *     Haddow, Holton, Stokes)
 *   - Botanic Tonics — 2 lobbyists (both deregistered Jan 2026)
 *   - Global Kratom Coalition — 1 lobbyist (deregistered Jan 2026)
 *
 * Usage:
 *   node --env-file=.env.local scripts/scrape-utah-lobbying.mjs
 *   node --env-file=.env.local scripts/scrape-utah-lobbying.mjs --dry-run
 *   node --env-file=.env.local scripts/scrape-utah-lobbying.mjs --include-all
 *     # store every row, not just kratom-flagged (for future
 *     # editorial cross-reference against expanded keyword lists)
 *
 * Idempotent: UNIQUE(state, lobbyist_name, principal_name, start_date)
 * means re-running updates the same row instead of creating duplicates.
 * End dates are kept fresh because we re-write them every run.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const INCLUDE_ALL = args.includes("--include-all");

const SOURCE_URL = "https://lobbyist.utah.gov/Search/LobbyistByPrincipal";

// =============================================================
// Kratom-industry principal pattern. Keep this list in sync with
// kratom-industry-actors.ts faction-org names. Designed to be
// conservative — false negatives are fine here (we can re-flag
// later by running with --include-all and grepping); false positives
// would pollute the briefing.
// =============================================================
const KRATOM_PRINCIPAL_RX = new RegExp(
  [
    "kratom",                       // AKA, GKC, Kratom Trade Association, etc.
    "botanic[ -]tonic",             // Botanic Tonics (J.W. Ross / Feel Free / GKC founder)
    "7[ -]?oh",                     // 7-OH advocacy groups
    "7-?hydroxymitragynine",
    "mitragyn",                     // Mitragyna-anything
    "plant science and health",     // CPSH — AKA's shell entity
    "feel\\s?free",                 // BT product brand
    "urban\\s+ice",                 // GKC member
    "mit\\s*45",                    // MIT45 (GKC member)
    "top\\s*tree",                  // Top Tree (GKC member)
    "new\\s+brew",                  // New Brew (GKC member)
    "og\\s+kratom",
    "kava\\s+garden",
    "pure\\s+leaf",                 // (note: also a tea brand — accept the false positive)
    "7-hope",                       // 7-HOPE Alliance
  ].join("|"),
  "i",
);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Fetch + parse
// =============================================================
console.log(`Fetching ${SOURCE_URL}…`);
const t0 = Date.now();
const resp = await fetch(SOURCE_URL, {
  headers: {
    // Identify ourselves so the registry sysadmin can contact us if
    // they want to. Don't pretend to be a browser.
    "User-Agent": "iKratom-policy-monitor/1.0 (contact: ohjustadam@proton.me)",
    "Accept": "text/html,application/xhtml+xml",
  },
});
if (!resp.ok) {
  console.error(`HTTP ${resp.status} from Utah lobbyist registry`);
  process.exit(1);
}
const html = await resp.text();
console.log(`Fetched ${(html.length / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Each row is a <tr> with: lobbyist, type, principal+address block, start, end.
// The principal cell contains a <b>name</b> followed by <br/>-separated
// address lines. We extract the name with a tight inner <b>...</b> match
// and pull the remaining address fragments after.
const rowRe = /<tr>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*<b>([^<]+?)<\/b>([\s\S]*?)<\/td>\s*<td>([^<]+?)<\/td>\s*<td>([^<]*?)<\/td>\s*<\/tr>/g;

function parseAddressBlock(block) {
  // The block after the </b> looks like:
  //   <br />\n  5501 Merchants View Square\n  202\n  <br />\n
  //   Haymarket,\n  20169\n  <br />\n  (757) 633-6222
  // We strip tags + entities, split by line, trim. The order is roughly:
  //   street1, [street2/suite], "City, ZIP", phone
  // ZIP is parsed loosely (5 or 9 digits).
  const stripped = block
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
  const lines = stripped.split("\n").map(s => s.trim()).filter(Boolean);
  let street = null, city = null, stateAbbr = null, zip = null, phone = null;
  // Phone is whatever line has a phone-shaped substring.
  for (const ln of lines) {
    const phoneMatch = ln.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    if (phoneMatch) { phone = phoneMatch[0]; break; }
  }
  // City,ZIP line — usually "City,\n  ZIP" in Utah's output. So the
  // line with a trailing comma is city, and the next short line is ZIP.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].endsWith(",")) {
      city = lines[i].slice(0, -1).trim();
      // ZIP might be on the next line (Utah's pattern) OR on the
      // same line after the comma.
      if (i + 1 < lines.length && /^\d{5}(-?\d{4})?$/.test(lines[i + 1])) {
        zip = lines[i + 1];
      }
      // Look for a 2-letter state in lines BEFORE the city
      // (Utah's layout puts city last among address lines).
      const before = lines.slice(0, i).join(" ");
      const stMatch = before.match(/\b([A-Z]{2})\b/);
      if (stMatch) stateAbbr = stMatch[1];
      break;
    }
  }
  // Street is everything before the city line (joined). Strip phone if
  // it's sneaked into the same line.
  if (lines.length > 0) {
    const cityIdx = lines.findIndex(ln => ln.endsWith(","));
    const streetLines = cityIdx > 0 ? lines.slice(0, cityIdx) : [lines[0]];
    street = streetLines.join(" ").trim() || null;
  }
  return { street, city, state: stateAbbr, zip, phone };
}

function normalizeLobbyistName(raw) {
  // Utah uses "Last, First" — normalize to "First Last".
  // Some entries have "Last, First M." or "Last, First Middle"
  // — keep middle names intact.
  if (!raw) return raw;
  if (!raw.includes(",")) return raw.trim();
  const [last, first] = raw.split(",", 2).map(s => s.trim());
  if (!last || !first) return raw.trim();
  return `${first} ${last}`;
}

function parseDate(s) {
  // Utah format: MM/DD/YYYY
  const m = s?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// =============================================================
// Parse all rows
// =============================================================
const rows = [];
let m;
while ((m = rowRe.exec(html))) {
  const [, lobRaw, type, principal, addressBlock, startRaw, endRaw] = m;
  const lobbyistName = normalizeLobbyistName(lobRaw);
  const addr = parseAddressBlock(addressBlock);
  const principalName = principal.trim();
  rows.push({
    state: "UT",
    lobbyist_name: lobbyistName,
    registration_type: type.trim(),
    principal_name: principalName,
    principal_address: addr.street,
    principal_city: addr.city,
    principal_state: addr.state,
    principal_zip: addr.zip,
    principal_phone: addr.phone,
    start_date: parseDate(startRaw),
    end_date: parseDate(endRaw),
    source_name: "utah-lobbyist-gov",
    source_url: SOURCE_URL,
    is_kratom_relevant: KRATOM_PRINCIPAL_RX.test(principalName),
  });
}
console.log(`Parsed ${rows.length} total registrations`);
const kratomRows = rows.filter(r => r.is_kratom_relevant);
console.log(`  Kratom-flagged: ${kratomRows.length}`);
if (kratomRows.length > 0) {
  console.log(`\n  Kratom-related rows:`);
  for (const r of kratomRows) {
    const status = r.end_date ? `ended ${r.end_date}` : "ACTIVE";
    console.log(`    ${r.lobbyist_name.padEnd(28)} → ${r.principal_name.padEnd(40)} since ${r.start_date} (${status})`);
  }
}

if (DRY_RUN) {
  console.log("\nDRY RUN — skipping insert.");
  process.exit(0);
}

// =============================================================
// Upsert. Idempotent via UNIQUE constraint.
// =============================================================
const toWrite = INCLUDE_ALL ? rows : kratomRows;
console.log(`\nUpserting ${toWrite.length} rows…`);

const BATCH = 500;
let written = 0;
let conflictHandled = 0;
for (let i = 0; i < toWrite.length; i += BATCH) {
  const chunk = toWrite.slice(i, i + BATCH);
  const { error, data } = await sb
    .from("state_lobbyist_registrations")
    .upsert(chunk, { onConflict: "state,lobbyist_name,principal_name,registration_type,start_date", ignoreDuplicates: false })
    .select("id");
  if (error) {
    console.error(`  chunk ${i / BATCH} error: ${error.message}`);
    continue;
  }
  written += data?.length ?? 0;
  conflictHandled += chunk.length - (data?.length ?? 0);
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${written} rows written/updated, ${conflictHandled} unchanged.`);

// =============================================================
// Quick post-run summary: who's currently active for kratom in Utah?
// =============================================================
const { data: active, error: aErr } = await sb
  .from("state_lobbyist_registrations")
  .select("lobbyist_name, principal_name, start_date")
  .eq("state", "UT")
  .eq("is_kratom_relevant", true)
  .is("end_date", null)
  .order("start_date", { ascending: false });

if (!aErr && active) {
  console.log(`\n=== Currently active kratom-industry lobbyists in Utah (${active.length}) ===`);
  for (const r of active) {
    console.log(`  ${r.lobbyist_name.padEnd(28)} for ${r.principal_name.padEnd(40)} since ${r.start_date}`);
  }
}

// Telemetry (audit 2026-07-16: registered in cron-registry.ts but never wrote).
try {
  await sb.from("scraper_runs").insert({
    source: "scrape_utah_lobbyist_registry",
    started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: active?.length ?? 0,
    notes: `${active?.length ?? 0} active kratom-industry registrations`,
  });
} catch { /* best-effort */ }

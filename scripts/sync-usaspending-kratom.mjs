/**
 * Sync kratom-mentioning federal awards from USAspending.gov.
 *
 * The federal-money-flow layer of the war machine. Surfaces:
 *   - Contracts: federal agencies paying private companies for
 *     kratom research / studies / surveillance work
 *   - Grants: NIH/NIDA/SAMHSA research grants, cooperative
 *     agreements with academic institutions
 *
 * As of 2026-05-14, the public corpus contains ONE high-signal
 * contract: $2,370,057 from FDA to Altasciences Clinical Kansas
 * Inc for "Dose-finding study of kratom alkaloids pilot." The
 * sync framework is in place for when more awards land — NIH grant
 * cycles tend to announce in Q4 / Q1 fiscal years.
 *
 * Source: https://api.usaspending.gov v2. Free, no key required.
 * Rate limit ~2,500/min (way more than we need for ~1-5 awards/run).
 *
 * Why the awards are split across two API calls: USAspending's
 * /search/spending_by_award endpoint requires award_type_codes to
 * be set (it can't return ALL types in one query). We do contracts
 * + grants separately and merge.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-usaspending-kratom.mjs
 *   node --env-file=.env.local scripts/sync-usaspending-kratom.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const DRY_RUN = flag("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const USER_AGENT = "iKratom-policy-monitor/1.0 (contact: ohjustadam@proton.me)";

// =============================================================
// Award-type buckets. The USAspending search endpoint requires
// award_type_codes; we run two queries (contracts, grants) and
// merge so we capture both ends of the money flow.
// =============================================================
// USAspending requires award_type_codes from one group per query.
// We loop these groups so we cover the whole money-flow universe.
const AWARD_GROUPS = [
  { name: "contracts",   codes: ["A", "B", "C", "D"],          category: "contract" },
  { name: "grants",      codes: ["02", "03", "04", "05"],       category: "grant" },
  { name: "direct-pay",  codes: ["06", "10"],                   category: "grant" },
  { name: "loans",       codes: ["07", "08"],                   category: "loan" },
  { name: "insurance",   codes: ["09"],                          category: "other" },
  { name: "other-asst",  codes: ["11"],                          category: "other" },
  { name: "idv",         codes: ["IDV_A", "IDV_B", "IDV_C", "IDV_D", "IDV_E"], category: "idv" },
];

const AWARD_TYPE_LABEL = {
  A: "Definitive Contract", B: "Purchase Order", C: "Delivery Order", D: "BPA Call",
  "02": "Block Grant", "03": "Formula Grant", "04": "Project Grant", "05": "Cooperative Agreement",
  "06": "Direct Payment for Specified Use", "07": "Direct Loan", "08": "Guaranteed/Insured Loan",
  "09": "Insurance", "10": "Direct Payment with Unrestricted Use", "11": "Other Financial Assistance",
};

// =============================================================
// Heuristic: is this award likely RESEARCH? Surfaces academic / clinical
// studies that may produce papers cited in future rulemaking.
// =============================================================
const RESEARCH_RE = /\b(study|research|trial|clinical|pharmacolog|toxicolog|pilot|investigat|grant|analysis|fellowship|education|training|surveillan)/i;

// =============================================================
// Run one keyword + type-set query, return parsed rows.
// =============================================================
async function fetchByType(keyword, typeCodes, category) {
  const body = {
    filters: { keywords: [keyword], award_type_codes: typeCodes },
    fields: [
      "Award ID", "Recipient Name", "Award Amount", "Description",
      "Awarding Agency", "Awarding Sub Agency", "Award Type",
      "Start Date", "End Date", "recipient_id",
    ],
    page: 1,
    limit: 100,
    sort: "Award Amount",
    order: "desc",
  };
  const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`USAspending ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.results ?? []).map(r => toRow(r, category));
}

// =============================================================
// Map USAspending result → schema row
// =============================================================
function toRow(r, category) {
  const awardType = r["Award Type"] ?? r.award_type ?? null;
  const desc = r["Description"] ?? r.description ?? null;
  const isResearch = desc ? RESEARCH_RE.test(desc) : false;
  const awardId = r["Award ID"] ?? r.generated_internal_id;
  return {
    usa_award_id: String(awardId ?? ""),
    usa_recipient_id: r.recipient_id ?? null,
    usa_url: awardId ? `https://www.usaspending.gov/award/${awardId}` : null,
    award_type: awardType,
    award_type_label: AWARD_TYPE_LABEL[awardType] ?? awardType ?? null,
    category,
    amount: Number(r["Award Amount"] ?? 0),
    amount_funded: r["Total Outlays"] != null ? Number(r["Total Outlays"]) : null,
    awarding_agency: r["Awarding Agency"] ?? null,
    awarding_sub_agency: r["Awarding Sub Agency"] ?? null,
    recipient_name: (r["Recipient Name"] ?? "(unknown recipient)").slice(0, 500),
    recipient_state: r.recipient_state_code ?? null,
    recipient_zip: r.recipient_zip ?? null,
    start_date: r["Start Date"] || null,
    end_date: r["End Date"] || null,
    description: desc ? String(desc).slice(0, 2000) : null,
    cfda_number: r.cfda_number ?? null,
    naics_code: r.naics_code ?? null,
    psc_code: r.psc_code ?? null,
    is_research: isResearch,
    kratom_relevance: "confirmed",  // we filtered on the keyword
    source: "usaspending",
    raw_json: r,
    synced_at: new Date().toISOString(),
  };
}

// =============================================================
// Main
// =============================================================
const t0 = Date.now();
console.log(`Syncing kratom-mentioning federal awards from USAspending.gov${DRY_RUN ? " (DRY RUN)" : ""}…`);

// Self-healing telemetry: every run registers in scraper_runs (source matches
// check-cron-staleness) so a silent failure is visible in /admin/automation.
async function logRun(status, rows, notes) {
  try {
    await sb.from("scraper_runs").insert({
      source: "usaspending",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status,
      rows_added: rows,
      notes,
    });
  } catch { /* telemetry is best-effort — never block the run */ }
}

const allRows = [];
let fetchFails = 0;
for (const group of AWARD_GROUPS) {
  try {
    process.stdout.write(`  ${group.name} (${group.codes.join(",")})… `);
    const r = await fetchByType("kratom", group.codes, group.category);
    console.log(`${r.length}`);
    allRows.push(...r);
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 120)}`);
    fetchFails++;
  }
  await new Promise(r => setTimeout(r, 400));   // polite pacing
}

// Dedupe by usa_award_id (defensive — different searches shouldn't
// overlap but check anyway)
const seen = new Map();
for (const r of allRows) {
  if (r.usa_award_id) seen.set(r.usa_award_id, r);
}
const deduped = [...seen.values()];

console.log(`\n=== Summary ===`);
console.log(`  Total awards: ${deduped.length}`);
const totalAmount = deduped.reduce((a, r) => a + (r.amount || 0), 0);
console.log(`  Total federal money: $${totalAmount.toLocaleString()}`);
const research = deduped.filter(r => r.is_research);
console.log(`  Research-flagged: ${research.length}`);
for (const r of deduped.slice(0, 8)) {
  console.log(`  $${(r.amount || 0).toLocaleString().padStart(12)} · ${(r.awarding_sub_agency || r.awarding_agency || "?").slice(0, 30).padEnd(30)} → ${(r.recipient_name || "?").slice(0, 40)}`);
  if (r.description) console.log(`      ${r.description.slice(0, 120)}`);
}

if (DRY_RUN) {
  console.log(`\nDRY RUN — skipping insert.`);
  process.exit(0);
}
if (deduped.length === 0) {
  console.log(`\nNothing to write.`);
  await logRun(fetchFails > 0 ? "error" : "empty", 0, `${allRows.length} fetched, ${fetchFails} fetch error(s)`);
  process.exit(0);
}

const BATCH = 100;
let written = 0;
let batchFails = 0;
for (let i = 0; i < deduped.length; i += BATCH) {
  const chunk = deduped.slice(i, i + BATCH);
  const { error, data } = await sb
    .from("federal_awards")
    .upsert(chunk, { onConflict: "usa_award_id" })
    .select("id");
  if (error) {
    console.error(`  Batch ${i / BATCH} failed: ${error.message?.slice(0, 200)}`);
    batchFails++;
    continue;
  }
  written += data?.length ?? 0;
}

const failed = fetchFails + batchFails;
// "partial" (not "error") when some rows landed despite a few award-group fetch
// or batch hiccups — the run did its job. Only a run that wrote NOTHING is a
// real error. Keeps /admin/automation's failure list signal, not noise.
const usaStatus = failed > 0 ? (written > 0 ? "partial" : "error") : "success";
await logRun(usaStatus, written, `${deduped.length} awards, ${written} upserted, ${failed} error(s)`);
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${written} rows upserted${failed > 0 ? `, ${failed} error(s)` : ""}.`);

/**
 * Sync kratom-mentioning federal rulemaking from Regulations.gov.
 *
 * Regulations.gov is the canonical federal public-comment portal —
 * Notices of Proposed Rulemaking, Final Rules, agency Notices,
 * supporting documents, AND every public comment submitted. When
 * FDA / DEA / HHS opens a kratom proceeding, advocates need to see
 * it the day it drops, not weeks later via news.
 *
 * Source: api.regulations.gov v4. Free, requires API key from
 * api.data.gov (sign-up at api.data.gov/signup). DEMO_KEY also works
 * with lower rate limit (~30/hour vs ~1000/hour) — sufficient for
 * the small kratom corpus (62 docs total as of 2026-05-14).
 *
 * What we capture per document:
 *   - rg_document_id (canonical, idempotent upsert key)
 *   - agency_id (FDA / DEA / EPA / FTC etc.) — different battlefields
 *   - document_type (Notice / Rule / Proposed Rule / Public Submission)
 *   - title + abstract
 *   - posted_date, comment_start_date, comment_end_date
 *   - open_for_comment computed from dates at sync time
 *   - rg_url for the public deep-link
 *
 * Highest-leverage rows: open-for-comment NDI notifications and
 * Proposed Rules. These are the federal actions where advocates can
 * submit public comments TODAY and influence the rule. The briefing
 * surfaces these in a NATIONAL section visible to all state advocates.
 *
 * Polite: 1 request per second, identifies itself with a real UA.
 *
 * Usage:
 *   node --env-file=.env.local scripts/sync-regulations-gov-kratom.mjs
 *   node --env-file=.env.local scripts/sync-regulations-gov-kratom.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-regulations-gov-kratom.mjs --max-pages 3
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (n, fallback = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : fallback; };
const flag = (n) => args.includes(n);

const DRY_RUN = flag("--dry-run");
const MAX_PAGES = parseInt(arg("--max-pages", "10"), 10);

const RG_KEY = process.env.REGULATIONS_GOV_API_KEY || "DEMO_KEY";
const USING_DEMO = RG_KEY === "DEMO_KEY";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const USER_AGENT = "iKratom-policy-monitor/1.0 (contact: ohjustadam@proton.me)";

/**
 * Map Regulations.gov agency IDs to friendlier labels. Most are
 * already 2-4 char tickers, but some come through as full names.
 */
const AGENCY_LABELS = {
  FDA: "FDA", DEA: "DEA", HHS: "HHS", EPA: "EPA",
  FTC: "FTC", FCC: "FCC", USDA: "USDA", DOJ: "DOJ",
  OSHA: "OSHA", DOI: "DOI", DOL: "DOL", VA: "VA",
};

// =============================================================
// Fetch one page of Regulations.gov search results.
// =============================================================
async function fetchPage(page) {
  const url = `https://api.regulations.gov/v4/documents?filter%5BsearchTerm%5D=kratom&page%5Bsize%5D=25&page%5Bnumber%5D=${page}&sort=-postedDate`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": RG_KEY, "User-Agent": USER_AGENT, "Accept": "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 429) {
    const text = await res.text();
    throw new Error(`Regulations.gov 429 rate limited${USING_DEMO ? " (DEMO_KEY hit ~30/hr cap — register a free key at api.data.gov/signup for ~1000/hr)" : ""}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Regulations.gov ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// =============================================================
// Map a Regulations.gov result → our schema row.
// =============================================================
function toRow(r) {
  const a = r.attributes ?? {};
  const docId = r.id ?? a.documentId;
  const agencyId = String(a.agencyId ?? "UNK").toUpperCase();

  // Comment period detection. Regulations.gov reports commentStartDate
  // and commentEndDate as ISO date strings when applicable. If end is
  // in the future, the comment period is OPEN — and that's the
  // actionable signal we surface in briefings.
  const commentEnd = a.commentEndDate ? new Date(a.commentEndDate) : null;
  const openForComment = commentEnd != null && commentEnd.getTime() >= Date.now();

  return {
    rg_document_id: docId,
    rg_docket_id: a.docketId ?? null,
    rg_object_id: a.objectId ?? null,
    agency_id: AGENCY_LABELS[agencyId] ?? agencyId,
    document_type: a.documentType ?? null,
    subtype: a.subtype ?? null,
    title: (a.title ?? "(no title)").slice(0, 800),
    abstract: a.abstract ? String(a.abstract).slice(0, 4000) : null,
    cfr_part: a.cfrPart ?? null,
    posted_date: a.postedDate ?? null,
    comment_start_date: a.commentStartDate ? String(a.commentStartDate).slice(0, 10) : null,
    comment_end_date: a.commentEndDate ? String(a.commentEndDate).slice(0, 10) : null,
    effective_date: a.effectiveDate ? String(a.effectiveDate).slice(0, 10) : null,
    open_for_comment: openForComment,
    comments_count: Number.isFinite(a.commentCount) ? a.commentCount : 0,
    rg_url: a.frDocNum
      ? `https://www.regulations.gov/document/${docId}`
      : (docId ? `https://www.regulations.gov/document/${docId}` : null),
    fr_doc_number: a.frDocNum ?? null,
    is_actionable: openForComment,  // briefing renders these as a CTA
    source: "regulations.gov",
    raw_json: r,
    synced_at: new Date().toISOString(),
  };
}

// =============================================================
// Main
// =============================================================
const t0 = Date.now();
console.log(`Syncing kratom rulemaking from Regulations.gov${DRY_RUN ? " (DRY RUN)" : ""}…`);
console.log(`  Using ${USING_DEMO ? "DEMO_KEY (rate-limited)" : "registered API key"}`);

const allRows = [];
let totalElements = 0;

for (let page = 1; page <= MAX_PAGES; page++) {
  let data;
  try {
    data = await fetchPage(page);
  } catch (e) {
    console.error(`  Page ${page} fetch failed: ${e.message?.slice(0, 240)}`);
    break;
  }
  if (page === 1) totalElements = data.meta?.totalElements ?? 0;
  const results = data.data ?? [];
  if (results.length === 0) break;
  console.log(`  Page ${page}: ${results.length} results`);
  for (const r of results) allRows.push(toRow(r));
  if (results.length < 25) break;        // last page
  await new Promise(r => setTimeout(r, 1000));  // polite
}

const openForComment = allRows.filter(r => r.open_for_comment);
const byAgency = new Map();
for (const r of allRows) byAgency.set(r.agency_id, (byAgency.get(r.agency_id) || 0) + 1);

console.log(`\n=== Summary ===`);
console.log(`  Parsed ${allRows.length} of ${totalElements} kratom-mentioning federal docs`);
console.log(`  By agency: ${[...byAgency.entries()].map(([a, c]) => `${a}=${c}`).join(", ")}`);
console.log(`  Open for comment NOW (advocates can submit): ${openForComment.length}`);
for (const r of openForComment.slice(0, 8)) {
  console.log(`    [${r.agency_id}] ${(r.posted_date ?? "?").slice(0, 10)} · closes ${r.comment_end_date} · ${r.title.slice(0, 100)}`);
}

if (DRY_RUN || allRows.length === 0) {
  console.log(`\n${DRY_RUN ? "DRY RUN — skipping insert." : "Nothing to write."}`);
  process.exit(0);
}

// Dedupe within the batch by rg_document_id (defensive — RG search
// has been stable but cross-page paginate-shift can occasionally
// repeat a row).
const seen = new Map();
for (const r of allRows) seen.set(r.rg_document_id, r);
const deduped = [...seen.values()];

const BATCH = 100;
let written = 0;
for (let i = 0; i < deduped.length; i += BATCH) {
  const chunk = deduped.slice(i, i + BATCH);
  const { error, data } = await sb
    .from("federal_rulemaking")
    .upsert(chunk, { onConflict: "rg_document_id" })
    .select("id");
  if (error) {
    console.error(`  Batch ${i / BATCH} failed: ${error.message?.slice(0, 200)}`);
    continue;
  }
  written += data?.length ?? 0;
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${written} rows upserted.`);
if (USING_DEMO && allRows.length > 30) {
  console.log(`\n💡 Register a free Regulations.gov API key at https://api.data.gov/signup`);
  console.log(`   for ~1000/hr quota (vs DEMO_KEY's ~30/hr). Then set REGULATIONS_GOV_API_KEY`);
  console.log(`   in .env.local + GitHub Actions secrets.`);
}

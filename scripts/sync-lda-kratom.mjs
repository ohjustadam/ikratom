#!/usr/bin/env node
/**
 * Senate LDA (Lobbying Disclosure Act) sync — kratom-relevant filings.
 *
 * The kratom industry's federal political influence does NOT flow
 * through FEC campaign contributions (KRATOM GROWTH PAC is dormant;
 * federal individual donations from kratom employees total ~$14k).
 * It flows through:
 *   - AKA's $4.5M/yr 501(c)(4) lobbying
 *   - GKC's $3M-class shell-style lobbying
 *   - Botanical Education Alliance (BEA) sub-coalition
 *   - DC lobbying firms (Upstream Consulting, Valente & Associates,
 *     The Raben Group)
 *
 * All of this is disclosed quarterly via LDA at lda.senate.gov.
 * Their REST API is public, no auth required, hits available at
 * https://lda.senate.gov/api/v1/filings/ — we filter by
 * filing_specific_lobbying_issues=kratom.
 *
 * ~276 filings exist as of May 2026 (12 pages × ~25/page). Each
 * filing has: registrant, client, financials, lobbying activities
 * with issue codes / government entities contacted / lobbyist names.
 *
 * Idempotent: upserts on filing_uuid. Re-running won't dupe.
 *
 * Run:
 *   node --env-file=.env.local scripts/sync-lda-kratom.mjs
 *   node --env-file=.env.local scripts/sync-lda-kratom.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-lda-kratom.mjs --max-pages 3
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const MAX_PAGES = parseInt(
  args[args.indexOf("--max-pages") + 1] ?? "50",
  10,
);

const PAGE_SIZE = 25;
const BASE = "https://lda.senate.gov/api/v1/filings/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page) {
  const u = new URL(BASE);
  u.searchParams.set("filing_specific_lobbying_issues", "kratom");
  u.searchParams.set("page", String(page));
  u.searchParams.set("page_size", String(PAGE_SIZE));
  const r = await fetch(u.toString(), {
    headers: { "Accept": "application/json", "User-Agent": "ikratom-intel/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) {
    throw new Error(`LDA API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  return r.json();
}

function rowFromFiling(f) {
  // Flatten lobbying_activities into the aggregate fields. Each filing
  // can have multiple activities; we union their issue codes, free-text
  // descriptions, government entities, and lobbyist roster.
  const issueCodes = new Set();
  const issueDescriptions = [];
  const govtEntities = new Set();
  const lobbyists = [];
  const seenLobbyistIds = new Set();

  for (const act of f.lobbying_activities ?? []) {
    if (act.general_issue_code) issueCodes.add(act.general_issue_code);
    if (act.description?.trim()) issueDescriptions.push(act.description.trim());
    for (const ge of act.government_entities ?? []) {
      const name = ge?.name ?? ge;
      if (typeof name === "string" && name) govtEntities.add(name);
    }
    for (const lobEntry of act.lobbyists ?? []) {
      const l = lobEntry.lobbyist ?? lobEntry;
      if (!l) continue;
      const id = l.id ?? `${l.first_name}-${l.last_name}`;
      if (seenLobbyistIds.has(id)) continue;
      seenLobbyistIds.add(id);
      lobbyists.push({
        id: l.id,
        first_name: l.first_name,
        middle_name: l.middle_name,
        last_name: l.last_name,
        suffix: l.suffix,
        covered_position: lobEntry.covered_position ?? null,
      });
    }
  }

  return {
    filing_uuid: f.filing_uuid,
    filing_type: f.filing_type,
    filing_type_display: f.filing_type_display,
    filing_year: f.filing_year,
    filing_period: f.filing_period,
    filing_period_display: f.filing_period_display,
    filing_document_url: f.filing_document_url,
    dt_posted: f.dt_posted,
    income: f.income != null ? Number(f.income) : null,
    expenses: f.expenses != null ? Number(f.expenses) : null,
    expenses_method: f.expenses_method ?? null,
    registrant_id: f.registrant?.id ?? null,
    registrant_name: f.registrant?.name ?? f.registrant_address_1 ?? null,
    registrant_city: f.registrant?.city ?? f.registrant_city ?? null,
    registrant_state: f.registrant?.state ?? f.registrant_state ?? null,
    client_id: f.client?.id ?? null,
    client_name: f.client?.name ?? null,
    client_state: f.client?.state ?? null,
    issue_codes: Array.from(issueCodes),
    issue_descriptions: issueDescriptions,
    government_entities: Array.from(govtEntities),
    lobbyists,
    is_kratom_relevant: true,
    raw_json: f,
    synced_at: new Date().toISOString(),
  };
}

// ── main ────────────────────────────────────────────────────────────
const t0 = Date.now();
let totalSeen = 0;
let totalUpserted = 0;
let totalFailed = 0;

console.log(`Senate LDA kratom-filing sync — paginating up to ${MAX_PAGES} pages${DRY ? " (DRY RUN)" : ""}`);

for (let page = 1; page <= MAX_PAGES; page++) {
  let data;
  try {
    data = await fetchPage(page);
  } catch (e) {
    console.error(`✗ page ${page}: ${e.message?.slice(0, 200)}`);
    break;
  }
  const results = data.results ?? [];
  if (results.length === 0) {
    console.log(`page ${page}: empty — stopping`);
    break;
  }
  totalSeen += results.length;

  // Dedupe by filing_uuid within the batch — the LDA API returns
  // one row per (filing × lobbying_activity), so a filing with 3
  // activities appears 3 times. Our rowFromFiling already unions
  // activities at the filing level, so any two rows with the same
  // filing_uuid carry identical data — last-wins is safe.
  const rowsRaw = results.map(rowFromFiling);
  const dedupedMap = new Map();
  for (const r of rowsRaw) dedupedMap.set(r.filing_uuid, r);
  const rows = Array.from(dedupedMap.values());
  console.log(`page ${page}: ${results.length} api rows → ${rows.length} unique filings · first: ${rows[0].registrant_name?.slice(0, 30)} / ${rows[0].client_name?.slice(0, 30)} / ${rows[0].filing_year}`);

  if (!DRY) {
    const { error } = await sb
      .from("lobbying_filings")
      .upsert(rows, { onConflict: "filing_uuid" });
    if (error) {
      console.error(`  ✗ upsert failed: ${error.message?.slice(0, 200)}`);
      totalFailed += rows.length;
    } else {
      totalUpserted += rows.length;
    }
  }

  // Last page?
  if (!data.next) {
    console.log(`page ${page}: no next page — done`);
    break;
  }
  await sleep(800); // polite — LDA API has no documented rate limit, stay sane
}

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${dur}s — seen ${totalSeen} filings, upserted ${totalUpserted}, failed ${totalFailed}`);

// Log run
try {
  await sb.from("scraper_runs").insert({
    source: "sync_lda_kratom",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: totalFailed > 0 ? "error" : "success",
    rows_added: totalUpserted,
    notes: `${totalSeen} seen, ${totalUpserted} upserted, ${totalFailed} failed`,
  });
} catch { /* best-effort */ }

process.exit(totalFailed > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * sync-elections.mjs — keyless US election-date calendar (#19).
 *
 * Source of truth for the geofenced election layer on /calendar +
 * /calendar/feed.ics. Two real, free sources:
 *   1. The deterministic federal general election date (2 U.S.C. — first
 *      Tuesday after the first Monday in November of even years).
 *   2. NCSL "2026 State Primary Election Dates" — a server-rendered HTML
 *      <table>, plain-curl scrapeable, no key, full 50-state coverage.
 *      (Verified live 2026-06-12; cross-checks the Google Civic API.)
 *
 * Free-tier compliant: no paid API, no key. NCSL footnotes that primary
 * dates can move by legislative action, so we re-sync weekly and self-heal
 * date changes by archiving future-dated NCSL rows that vanish from the
 * source (past elections are left untouched as history).
 *
 * The 0199 migration seeds the same data so the calendar works on db:push
 * alone; this script keeps it fresh. Matches by natural key
 * (scope, state, locality, election_type, election_date) — select-then-
 * update/insert, so re-runs never duplicate.
 *
 * Self-gates to WEEKLY: skips when the last successful run is younger than
 * 6 days, so it can sit in the nightly cloud chassis. Telemetry:
 * scraper_runs source `sync_elections`.
 *
 *   node --env-file=.env.local scripts/sync-elections.mjs
 *   node --env-file=.env.local scripts/sync-elections.mjs --force --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseHTML } = require("linkedom");

const NCSL_URL =
  "https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates";

// Federal general election: first Tuesday after the first Monday in November
// of even years. 2026 = Nov 3. Deterministic — seeded as a national row.
const GENERAL = {
  scope: "national",
  state: null,
  locality: null,
  election_type: "general",
  title: "2026 U.S. General Election",
  election_date: "2026-11-03",
  source: "federal_seed",
  source_url: "https://www.eac.gov",
};

const STATE_CODE = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY", "District of Columbia": "DC",
};

// MM/DD/YYYY -> YYYY-MM-DD (NCSL's column format); null if unparseable.
const mdy = (s) => {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();
const NOW = () => new Date().toISOString();
const today = NOW().slice(0, 10);

// Weekly self-gate. Excludes [dry-run] rows so a dry-run never defers a real
// sync (mirrors sync-state-executives.mjs).
if (!FORCE) {
  const { data } = await sb.from("scraper_runs")
    .select("finished_at").eq("source", "sync_elections").eq("status", "success")
    .not("notes", "ilike", "%[dry-run]%")
    .order("finished_at", { ascending: false }).limit(1);
  const last = data?.[0]?.finished_at ? new Date(data[0].finished_at).getTime() : 0;
  if (last && Date.now() - last < 6 * 864e5) {
    console.log(`sync-elections: last sync ${((Date.now() - last) / 864e5).toFixed(1)}d ago — weekly gate, skipping (--force overrides).`);
    process.exit(0);
  }
}

/** Fetch + parse the NCSL primary table into election rows. */
function parseNcsl(html) {
  const { document } = parseHTML(html);
  const rows = document.querySelectorAll("table tr");
  const out = [];
  let unmapped = 0;
  for (let i = 1; i < rows.length; i++) {
    const c = [...rows[i].querySelectorAll("td,th")].map((x) => x.textContent.replace(/\s+/g, " ").trim());
    if (c.length < 2) continue;
    // "Alabama (most offices)" -> base "Alabama", office "most offices".
    const pm = c[0].match(/^([^(]+?)\s*(?:\(([^)]*)\))?\.?$/);
    const base = (pm ? pm[1] : c[0]).trim().replace(/\.$/, "");
    const office = pm && pm[2] ? pm[2].replace(/\.$/, "").trim() : null;
    const code = STATE_CODE[base];
    if (!code) { unmapped++; console.warn(`  ⚠ no state code for ${JSON.stringify(base)}`); continue; }
    const suffix = office ? ` — ${office}` : "";
    const pdate = mdy(c[1]);
    if (pdate) out.push({ scope: "state", state: code, locality: null, election_type: "primary", title: `${base} 2026 Primary${suffix}`, election_date: pdate, source: "ncsl", source_url: NCSL_URL });
    const rdate = mdy(c[2]);
    if (rdate) out.push({ scope: "state", state: code, locality: null, election_type: "primary_runoff", title: `${base} 2026 Primary Runoff${suffix}`, election_date: rdate, source: "ncsl", source_url: NCSL_URL });
  }
  return { rows: out, unmapped };
}

console.log("sync-elections: fetching NCSL 2026 primary dates…");
let parsed = { rows: [], unmapped: 0 };
let ncslOk = false;
try {
  const res = await fetch(NCSL_URL, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`NCSL ${res.status}`);
  parsed = parseNcsl(await res.text());
  ncslOk = parsed.rows.length > 0;
  console.log(`  parsed ${parsed.rows.length} state row(s)${parsed.unmapped ? ` (${parsed.unmapped} unmapped)` : ""}`);
} catch (e) {
  // Don't abort: the deterministic national general still upserts so a
  // bad scrape never wipes the calendar. Telemetry records the failure.
  console.error(`  ✗ NCSL fetch/parse failed: ${e.message}`);
}

// National general always upserts; NCSL state rows when the scrape worked.
const incoming = [GENERAL, ...parsed.rows];

let inserted = 0, updated = 0, archived = 0;
for (const e of incoming) {
  let q = sb.from("election_dates").select("id")
    .eq("scope", e.scope).eq("election_type", e.election_type).eq("election_date", e.election_date);
  q = e.state == null ? q.is("state", null) : q.eq("state", e.state);
  q = e.locality == null ? q.is("locality", null) : q.eq("locality", e.locality);
  const { data: existing } = await q.maybeSingle();

  if (DRY) {
    console.log(`  · [${e.state ?? "US"}] ${e.election_type} ${e.election_date} — ${existing ? "update" : "insert"}: ${e.title}`);
    continue;
  }
  if (existing) {
    const { error } = await sb.from("election_dates").update({
      title: e.title, source: e.source, source_url: e.source_url, synced_at: NOW(),
    }).eq("id", existing.id);
    if (error) { console.log(`  ✗ update ${e.title}: ${error.message.slice(0, 80)}`); continue; }
    updated++;
  } else {
    const { error } = await sb.from("election_dates").insert({
      scope: e.scope, state: e.state, locality: e.locality, election_type: e.election_type,
      title: e.title, election_date: e.election_date, source: e.source, source_url: e.source_url,
      moderation_status: "approved", synced_at: NOW(),
    });
    if (error) { console.log(`  ✗ insert ${e.title}: ${error.message.slice(0, 80)}`); continue; }
    inserted++;
  }
}

// Self-heal date changes: archive FUTURE-dated NCSL rows that are no longer
// in the source (a moved primary leaves a stale old-date row). Past elections
// are kept as history. Skipped if the scrape failed (never archive on a bad
// fetch — that would blank the calendar on a transient NCSL outage).
if (!DRY && ncslOk) {
  const live = new Set(parsed.rows.map((r) => `${r.state}|${r.election_type}|${r.election_date}`));
  const { data: futureNcsl } = await sb.from("election_dates")
    .select("id, state, election_type, election_date")
    .eq("source", "ncsl").eq("moderation_status", "approved").gte("election_date", today);
  const stale = (futureNcsl ?? []).filter((r) => !live.has(`${r.state}|${r.election_type}|${r.election_date}`));
  if (stale.length) {
    await sb.from("election_dates").update({ moderation_status: "archived", synced_at: NOW() }).in("id", stale.map((r) => r.id));
    archived = stale.length;
  }
}

console.log(`\nDone. inserted=${inserted} updated=${updated} archived=${archived}${DRY ? " [dry-run]" : ""}`);
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "sync_elections",
      started_at: new Date(t0).toISOString(),
      finished_at: NOW(),
      // A failed NCSL scrape still upserts the national general → "empty" not
      // "fail" when only the general landed; "success" when state rows synced.
      status: ncslOk ? "success" : "empty",
      rows_updated: inserted + updated,
      notes: `ncsl_rows=${parsed.rows.length} inserted=${inserted} updated=${updated} archived=${archived}${parsed.unmapped ? ` unmapped=${parsed.unmapped}` : ""}`.slice(0, 300),
    });
  } catch { /* best-effort */ }
}
process.exit(0);

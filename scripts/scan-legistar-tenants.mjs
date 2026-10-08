#!/usr/bin/env node
/**
 * Scan upcoming Legistar agendas for kratom items — via the keyless webapi.
 *
 * For every Legistar tenant we know (live rows in `legistar_tenants` plus the
 * static big-city list), read the meetings in the next --days days and their
 * agenda items, and file any meeting with a kratom item into municipal_meetings.
 * Structured clerk data end to end — no model, no page scraping — so rows go in
 * as `discovered_via: "legistar_scan"`, which auto-approve-meetings is allowed
 * to publish (scripts/lib/meeting-autoapprove.mjs). A match on a bare "7-OH"
 * alone is held below the publish floor for a human.
 *
 * REWRITTEN 2026-10-08. The previous version scraped Calendar.aspx, which is
 * rendered client-side: every tenant printed "no meeting links found" and the
 * job logged "0 hits" every night while having read nothing. This version also
 * reports per-tenant API outcomes, so an empty night and a broken scan no longer
 * look the same.
 *
 * Run:
 *   node --env-file=.env.local scripts/scan-legistar-tenants.mjs --dry-run
 *   node --env-file=.env.local scripts/scan-legistar-tenants.mjs --tenant seattle --days 90
 */
import { createClient } from "@supabase/supabase-js";
import { LEGISTAR_TENANTS } from "./lib/legistar-tenants.mjs";
import { webapiClientFor } from "./lib/legistar-officials.mjs";
import { kratomItems, buildMeetingRow, mergeTenants } from "./lib/legistar-events.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const num = (flag, dflt) => { const n = Number(arg(flag)); return Number.isFinite(n) && n > 0 ? n : dflt; };
const TENANT_FILTER = arg("--tenant");
const DRY_RUN = args.includes("--dry-run");
const DAYS = num("--days", 45);
const MAX_MINUTES = num("--max-minutes", 30);
const MAX_EVENTS_PER_TENANT = num("--max-events", 60);

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const WEBAPI = "https://webapi.legistar.com/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const overBudget = () => Date.now() - t0 > MAX_MINUTES * 60_000;

/** GET JSON; classifies the failures a tenant can have. */
async function getJson(path) {
  try {
    const res = await fetch(`${WEBAPI}${path}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)", Accept: "application/json" },
    });
    const text = await res.text();
    if (res.status === 401 || res.status === 403) return { fail: "token" };   // tenant requires an API token
    if (/not set up in InSite/i.test(text)) return { fail: "gone" };          // client no longer on Legistar
    if (!res.ok) return { fail: `http-${res.status}` };
    return { data: JSON.parse(text) };
  } catch (e) {
    return { fail: e?.name === "TimeoutError" ? "timeout" : "error" };
  }
}

// ---------- tenants ----------
const { data: dbRows, error: dbErr } = await sb.from("legistar_tenants")
  .select("state, locality, webapi_client, body").eq("probe_status", "live");
if (dbErr) console.log(`⚠ legistar_tenants read failed (${dbErr.message}) — static list only`);
let tenants = mergeTenants(dbRows ?? [], LEGISTAR_TENANTS, webapiClientFor);
if (TENANT_FILTER) tenants = tenants.filter((t) => t.client === TENANT_FILTER);
if (tenants.length === 0) { console.error(`No matching tenant: ${TENANT_FILTER}`); process.exit(1); }

// --from lets a dry run replay a past window to prove the detector still finds
// a known kratom agenda (Naperville passed one 2026-08-10/21). Never writes past
// meetings: the calendar and reminders are for upcoming ones.
const realToday = new Date().toISOString().slice(0, 10);
const FROM = arg("--from");
if (FROM && (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || (FROM < realToday && !DRY_RUN))) {
  console.error("--from must be YYYY-MM-DD, and a past date needs --dry-run"); process.exit(2);
}
const today = FROM ?? realToday;
const until = new Date(Date.parse(today) + DAYS * 86_400_000).toISOString().slice(0, 10);
console.log(`Scanning ${tenants.length} Legistar tenant(s), meetings ${today} → ${until}${DRY_RUN ? " [DRY RUN]" : ""}…\n`);

const outcome = {}; // fail reason / "ok" → count
let events = 0, itemCalls = 0, hits = 0, inserted = 0, dupes = 0, budgetHit = false;
const goneClients = []; // live in legistar_tenants, but the webapi says the client no longer exists

for (const t of tenants) {
  if (overBudget()) { budgetHit = true; break; }
  process.stdout.write(`  ${t.locality.padEnd(30)} `);
  const filter = encodeURIComponent(`EventDate ge datetime'${today}' and EventDate le datetime'${until}'`);
  const ev = await getJson(`/${t.client}/events?$filter=${filter}&$orderby=EventDate&$top=${MAX_EVENTS_PER_TENANT}`);
  if (ev.fail) {
    outcome[ev.fail] = (outcome[ev.fail] ?? 0) + 1;
    if (ev.fail === "gone" && t.fromDb) goneClients.push(t.client);
    console.log(`✗ ${ev.fail}`); await sleep(300); continue;
  }
  outcome.ok = (outcome.ok ?? 0) + 1;
  const list = Array.isArray(ev.data) ? ev.data : [];
  events += list.length;
  let tHits = 0;
  for (const e of list) {
    if (overBudget()) { budgetHit = true; break; }
    await sleep(250);
    const it = await getJson(`/${t.client}/events/${e.EventId}/eventitems?AgendaNote=1&MinutesNote=0&Attachments=0`);
    itemCalls++;
    if (it.fail || !Array.isArray(it.data)) continue;
    const found = kratomItems(it.data);
    if (!found.length) continue;
    const row = buildMeetingRow(t, e, found);
    if (!row) continue;
    hits++; tHits++;
    console.log(`\n    🎯 ${row.body_name} · ${row.meeting_at} · conf ${row.ai_confidence}\n       ${found[0].title.slice(0, 160)}`);
    if (DRY_RUN) continue;
    const { error } = await sb.from("municipal_meetings").insert(row);
    if (!error) inserted++;
    else if (error.code === "23505") dupes++; // already filed (state + locality + meeting_at)
    else console.log(`    ✗ DB: ${error.message?.slice(0, 120)}`);
  }
  console.log(`${tHits ? "" : "· "}${list.length} meeting(s)${tHits ? `, ${tHits} with kratom items` : ""}`);
  await sleep(300);
}

const outcomes = Object.entries(outcome).map(([k, v]) => `${v} ${k}`).join(", ");
const notes = `${tenants.length} tenants (${outcomes}) · ${events} meetings (${itemCalls} agendas read) · ${hits} with kratom items · ${inserted} new` +
  `${dupes ? ` · ${dupes} already filed` : ""}${budgetHit ? " · budget-hit" : ""}`;
console.log(`\nDone in ${((Date.now() - t0) / 60_000).toFixed(1)} min — ${notes}`);

// Self-heal the tenant cache: "not set up in InSite" is Legistar saying the
// client is gone for EVERY endpoint (verified 2026-10-08 on /bodies too), so the
// local-officials lookup would keep trying a dead tenant. 9 were stale at rewrite
// (Chicago, Atlanta, LA County, Miami, ...). NOTE: discover-legistar-tenants
// never re-probes a 'none' row, so if a city returns to Legistar, delete its row
// (or set probe_status back to 'live') and the next discovery run re-adds it.
if (!DRY_RUN && goneClients.length) {
  const { error } = await sb.from("legistar_tenants")
    .update({ probe_status: "none", probed_at: new Date().toISOString() })
    .in("webapi_client", goneClients).eq("probe_status", "live");
  console.log(error ? `⚠ couldn't retire gone tenants: ${error.message}` : `retired ${goneClients.length} gone tenant(s): ${goneClients.join(", ")}`);
}

if (!DRY_RUN) {
  try {
    await sb.from("scraper_runs").insert({
      source: "scan_legistar_tenants",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      // No tenant answered = the scan itself is broken, not a quiet week.
      status: (outcome.ok ?? 0) === 0 ? "fail" : inserted > 0 ? "success" : "empty",
      rows_added: inserted,
      notes: notes.slice(0, 500),
    });
  } catch { /* best-effort telemetry */ }
}
process.exit(0);

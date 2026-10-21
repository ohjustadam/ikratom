/**
 * sync-congress-roster-diff.mjs — keep the federal roster current with no human
 * in the loop. The Congress twin of sync-state-roster-diff.mjs (the officials-
 * turnover engine, private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md).
 *
 * Source: unitedstates/congress-legislators (keyless, maintained on the day of
 * every swearing-in, resignation and appointment). Joined on bioguide_id.
 *
 *   - active in ours, absent from the current list → NO LONGER IN OFFICE
 *     (active = false). Found on the first run 2026-10-21: Sen. Lindsey Graham
 *     was still active and contactable here after his seat passed to Sen.
 *     Darline Graham Nordone (sworn 2026-07-14).
 *   - current member absent from ours → added, with the term end the dataset
 *     publishes (exact for Congress: House 2027-01-03, Senate by class).
 *   - present in both → term_end_date kept in step with the dataset.
 * Territorial delegates (PR, GU, VI, AS, MP) are skipped: not tracked states.
 *
 *   node --env-file=.env.local scripts/sync-congress-roster-diff.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-congress-roster-diff.mjs            # apply
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const t0 = Date.now();
const SRC = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const MAX_DEPARTURES = 40; // a normal week is 0-3; more means the source broke

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function telemetry(status, notes, rows = 0) {
  try {
    await sb.from("scraper_runs").insert({
      source: "congress_roster_diff", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes: String(notes).slice(0, 500),
    });
  } catch { /* best-effort */ }
}

const res = await fetch(SRC, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) { await telemetry("error", `source ${res.status}`); throw new Error(`source ${res.status}`); }
const members = await res.json();
if (!Array.isArray(members) || members.length < 500) {
  await telemetry("error", `implausible source size ${members?.length}`);
  throw new Error("implausible source");
}

const { data: stateRows } = await sb.from("states").select("abbr");
const tracked = new Set((stateRows ?? []).map((s) => s.abbr));
const current = new Map();
for (const m of members) {
  const t = m.terms?.[m.terms.length - 1];
  if (!t || !tracked.has(t.state)) continue;
  current.set(m.id.bioguide, { m, t });
}

const { data: ours, error } = await sb.from("legislators")
  .select("id, bioguide_id, full_name, state, role, active, term_end_date")
  .eq("level", "federal").not("bioguide_id", "is", null).limit(2000);
if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
const oursByBio = new Map(ours.map((r) => [r.bioguide_id, r]));

const departed = ours.filter((r) => r.active && !current.has(r.bioguide_id));
const newcomers = [...current.entries()].filter(([bio]) => !oursByBio.has(bio));
const endFixes = ours.filter((r) => r.active && current.has(r.bioguide_id) && current.get(r.bioguide_id).t.end !== r.term_end_date);

console.log(`congress: ${current.size} current (tracked states) · departed ${departed.length} · new ${newcomers.length} · term-end fixes ${endFixes.length}`);
for (const r of departed) console.log(`  - leaving: ${r.state} ${r.full_name} (${r.role})`);
for (const [, { m, t }] of newcomers) console.log(`  + new: ${t.state} ${m.name.official_full ?? `${m.name.first} ${m.name.last}`} (${t.type}${t.district != null ? ` ${t.district}` : ""}, from ${t.start})`);

let changed = 0, failed = 0;
const errors = [];
if (!DRY) {
  if (departed.length > MAX_DEPARTURES) {
    await telemetry("error", `held: ${departed.length} departures exceeds ${MAX_DEPARTURES}`);
    throw new Error("too many departures, held for review");
  }
  for (const r of departed) {
    const { error: e } = await sb.from("legislators").update({ active: false, last_synced_at: new Date().toISOString() }).eq("id", r.id).eq("active", true);
    if (e) failed++; else changed++;
  }
  for (const [bio, { m, t }] of newcomers) {
    const { error: e } = await sb.from("legislators").insert({
      state: t.state, level: "federal", role: t.type === "sen" ? "us_senate" : "us_house",
      district: t.type === "rep" && t.district != null ? String(t.district) : null,
      full_name: m.name.official_full ?? `${m.name.first} ${m.name.last}`,
      party: t.party ?? null, phone: t.phone ?? null, website: t.url ?? null,
      email: t.contact_form ?? null, office_address: t.address ?? null,
      bioguide_id: bio, active: true, term_start_date: t.start ?? null, term_end_date: t.end ?? null,
      last_synced_at: new Date().toISOString(),
      verified_sources_md: `- Source: unitedstates/congress-legislators (${bio})\n- Added by sync-congress-roster-diff ${new Date().toISOString().slice(0, 10)}.`,
    });
    if (e) { failed++; if (errors.length < 5) errors.push(`${bio}: ${e.message}`); } else changed++;
  }
  for (const r of endFixes) {
    const { error: e } = await sb.from("legislators").update({ term_end_date: current.get(r.bioguide_id).t.end }).eq("id", r.id);
    if (e) failed++; else changed++;
  }
}
for (const e of errors) console.log(`  ! ${e}`);
const summary = `${DRY ? "DRY " : ""}departed ${departed.length} · new ${newcomers.length} · term-end fixes ${endFixes.length} · applied ${changed} · failed ${failed}`;
console.log(summary);
await telemetry(failed > 0 ? "error" : changed > 0 ? "success" : "empty", summary, changed);

/**
 * turnover-swap.mjs — on the handover day, the outgoing official leaves and
 * the successor takes the seat. The officials-turnover engine, part (d)
 * (private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md §1).
 *
 * For each seat_elections row marked successor_elected (two same-winner
 * readings of the result, ingest-election-results.mjs) whose handover day has
 * arrived — or a special election, whose winner takes office on certification:
 *
 *   SECOND SOURCE. The successor must appear IN OFFICE in an independent
 *   roster: openstates/people's current role for that chamber and district
 *   (state legislatures), or unitedstates/congress-legislators' current term
 *   for that state and district (Congress). The election result alone never
 *   retires anyone.
 *   Confirmed → the incumbent goes active = false, with a dated line in
 *   verified_sources_md (the record is kept, never deleted). Campaigns target
 *   on `active`, so nobody emails them again. The successor's row (added by
 *   the daily roster diffs, matched on openstates_id / bioguide_id) is linked
 *   as winner_id and the seat becomes swapped.
 *   Not confirmed three days after the handover → needs_review, listed on
 *   /admin/local-rep-requests. The incumbent stays active: a wrong departure
 *   is worse than a late one, and the roster diffs still catch it.
 *
 * Statewide executive seats are left to sync-state-executives.mjs; a stuck one
 * is surfaced for review a week after its handover.
 *
 * Daily, in cron-daily's roster-diff job right after the roster diffs.
 * Telemetry: scraper_runs source "turnover_swap".
 *
 *   node --env-file=.env.local scripts/turnover-swap.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball, currentRole } from "./lib/openstates-people.mjs";
import { normalizeDistrict, samePerson, addDays } from "./lib/term-calendar.mjs";

// --probe ST:office:district:Winner Name — a synthetic seat due today, to
// exercise the second-source check against the live rosters. Always dry.
const PROBE = process.argv.includes("--probe") ? process.argv[process.argv.indexOf("--probe") + 1] : null;
const DRY = process.argv.includes("--dry-run") || !!PROBE;
const t0 = Date.now();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const GRACE_DAYS = 3;
const EXEC_GRACE_DAYS = 7;
const MAX_SWAPS = 900; // the biggest single day (Jan 1 handovers) is a few hundred; more means a bad read
const CHAMBER = { state_senate: new Set(["upper", "legislature"]), state_house: new Set(["lower"]) };

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function telemetry(status, notes, rows = 0) {
  if (DRY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: "turnover_swap", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes: String(notes).slice(0, 500),
    });
  } catch { /* best-effort */ }
}

const { data: due, error } = await sb.from("seat_elections")
  .select("id, state, office, district, kind, election_date, handover_date, incumbent_id, incumbent_name, winner_name, winner_id, result_sources, status")
  .in("status", ["successor_elected", "needs_review"]).not("winner_name", "is", null).limit(5000);
if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
const ready = PROBE
  ? [(([state, office, district, winner]) => ({ id: "probe", state, office, district, kind: "regular", election_date: today, handover_date: today, incumbent_id: null, incumbent_name: "(probe)", winner_name: winner, result_sources: ["probe"], status: "successor_elected" }))(PROBE.split(":"))]
  : (due ?? []).filter((s) => (s.handover_date ? s.handover_date <= today : s.kind === "special")
    && (s.status === "successor_elected" || (s.result_sources ?? []).length >= 2));
if (ready.length === 0) { console.log("no seat changes hands today"); await telemetry("empty", "nothing due"); process.exit(0); }

// ── Second sources, fetched only when something needs them ────────────────
const needState = ready.some((s) => CHAMBER[s.office]);
const needFed = ready.some((s) => s.office === "us_house" || s.office === "us_senate");
const osCurrent = []; // { state, chamber, district, name, id }
if (needState) {
  const RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/legislature\/[^/]+\.ya?ml$/i;
  const files = await collectFromTarball(PEOPLE_TARBALL, RE);
  for (const [p, txt] of files) {
    let doc; try { doc = yaml.load(txt); } catch { continue; }
    const role = currentRole(doc, new Set(["upper", "lower", "legislature"]), today);
    if (role) osCurrent.push({ state: p.match(RE)[1].toUpperCase(), type: role.type, district: String(role.district ?? ""), name: doc.name, id: doc.id });
  }
}
const fedCurrent = [];
if (needFed) {
  const r = await fetch("https://unitedstates.github.io/congress-legislators/legislators-current.json", { signal: AbortSignal.timeout(60_000) });
  if (r.ok) for (const m of await r.json()) {
    const t = m.terms?.at(-1);
    if (t && t.start <= today) fedCurrent.push({ state: t.state, type: t.type, district: t.type === "rep" ? String(t.district ?? 0) : "", names: [m.name.official_full, `${m.name.first} ${m.name.last}`].filter(Boolean), bioguide: m.id.bioguide });
  }
}
const dkey = (d) => normalizeDistrict(d) ?? String(d ?? "").toLowerCase();

function confirm(seat) {
  const names = String(seat.winner_name).split(/,\s*/);
  if (CHAMBER[seat.office]) {
    const hit = osCurrent.find((p) => p.state === seat.state && CHAMBER[seat.office].has(p.type) && dkey(p.district) === dkey(seat.district) && names.some((n) => samePerson(n, p.name)));
    return hit ? { source: "openstates", openstates_id: hit.id } : null;
  }
  if (seat.office === "us_house" || seat.office === "us_senate") {
    const type = seat.office === "us_house" ? "rep" : "sen";
    const hit = fedCurrent.find((m) => m.state === seat.state && m.type === type && (type === "sen" || m.district === String(seat.district)) && names.some((n) => m.names.some((x) => samePerson(n, x))));
    return hit ? { source: "congress-legislators", bioguide_id: hit.bioguide } : null;
  }
  return undefined; // statewide executive: not this job's to confirm
}

let swapped = 0, retiredOnly = 0, flagged = 0, failed = 0;
const plan = [];
for (const seat of ready) {
  const c = confirm(seat);
  if (c) { plan.push({ seat, c }); continue; }
  const grace = c === undefined ? EXEC_GRACE_DAYS : GRACE_DAYS;
  if (seat.status === "successor_elected" && seat.handover_date && addDays(seat.handover_date, grace) < today) {
    flagged++;
    console.log(`  ? ${seat.state} ${seat.office} ${seat.district}: ${seat.winner_name} not yet in office in a second source`);
    if (!DRY) await sb.from("seat_elections").update({
      status: "needs_review", updated_at: new Date().toISOString(),
      review_reason: c === undefined
        ? `statewide office: handover ${seat.handover_date} passed; confirm ${seat.winner_name} took office (sync-state-executives)`
        : `handover ${seat.handover_date} passed; no second source shows ${seat.winner_name} in office yet`,
    }).eq("id", seat.id).eq("status", "successor_elected");
  }
}
if (plan.length > MAX_SWAPS) {
  await telemetry("error", `held: ${plan.length} swaps exceeds ${MAX_SWAPS}`);
  throw new Error("too many swaps in one run, held for review");
}

for (const { seat, c } of plan) {
  let successor = null;
  const col = c.openstates_id ? "openstates_id" : "bioguide_id";
  const { data: s } = await sb.from("legislators").select("id").eq(col, c.openstates_id ?? c.bioguide_id).eq("active", true).maybeSingle();
  successor = s?.id ?? null;
  console.log(`  ⇄ ${seat.state} ${seat.office} ${seat.district}: ${seat.incumbent_name} → ${seat.winner_name} (${c.source}${successor ? "" : ", successor row pending"})`);
  if (DRY) { successor ? swapped++ : retiredOnly++; continue; }

  if (seat.incumbent_id) {
    const { data: inc } = await sb.from("legislators").select("verified_sources_md, active").eq("id", seat.incumbent_id).maybeSingle();
    if (inc?.active) {
      const line = `- Left office ${seat.handover_date ?? today}: ${seat.winner_name} won the seat on ${seat.election_date} (${[...(seat.result_sources ?? []), c.source].join(", ")}). Retired by turnover-swap ${today}; record kept.`;
      const { error: e } = await sb.from("legislators").update({
        active: false, last_synced_at: new Date().toISOString(),
        verified_sources_md: [inc.verified_sources_md, line].filter(Boolean).join("\n"),
      }).eq("id", seat.incumbent_id).eq("active", true);
      if (e) { failed++; continue; }
    }
  }
  const { error: e2 } = await sb.from("seat_elections").update({
    status: successor ? "swapped" : "successor_elected", winner_id: successor, updated_at: new Date().toISOString(),
    result_sources: [...new Set([...(seat.result_sources ?? []), c.source])],
    review_reason: successor ? null : "incumbent retired; waiting for the successor's record (the roster diff adds it)",
  }).eq("id", seat.id);
  if (e2) failed++; else if (successor) swapped++; else retiredOnly++;
}

const summary = `${DRY ? "DRY " : ""}due ${ready.length} · swapped ${swapped} · incumbent retired, successor pending ${retiredOnly} · needs review ${flagged} · failed ${failed}`;
console.log(summary);
await telemetry(failed ? "error" : swapped + retiredOnly + flagged ? "success" : "empty", summary, swapped + retiredOnly);
if (failed) process.exit(1);

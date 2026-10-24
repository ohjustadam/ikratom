/**
 * ingest-election-results.mjs — who won each seat on the ballot. The
 * officials-turnover engine, part (c) (private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md §1).
 *
 * For every open seat_elections row (on_ballot / needs_review) of the cycle's
 * general election, reads the winner from the Wikipedia election article for
 * that chamber (state legislatures), or the national U.S. House / Senate /
 * statewide-office articles (scripts/lib/election-results.mjs), matched on
 * the district AND the incumbent's surname, so a row about an earlier special
 * election for the same district never stands in for this one.
 *
 * A reading changes nothing on the day it is first seen. It is stored as a
 * sighting (winner_name + "wikipedia:<day>") and the seat's status moves only
 * when a LATER day's reading names the same winner: a vandalised or premature
 * call has to survive a day to land. Then:
 *   - the incumbent won         → incumbent_reelected
 *   - someone else won          → successor_elected: the profile says
 *     "Leaving office on <handover day>", and the official stays active and
 *     contactable until turnover-swap.mjs confirms the successor from a
 *     second, independent roster source on or after that day.
 * A reading that changes between days is filed needs_review with both names.
 *
 * Runs daily (cron-daily roster-diff job); does nothing before election day
 * and stops 60 days after it. Telemetry: scraper_runs source "election_results".
 *
 *   node --env-file=.env.local scripts/ingest-election-results.mjs --dry-run
 *   node --env-file=.env.local scripts/ingest-election-results.mjs --force --state OK   # skip the date gate
 */
import { createClient } from "@supabase/supabase-js";
import { STATE_NAMES } from "./lib/us-states.mjs";
import { electionDay, normalizeDistrict, wikiTitles, sameSurname, samePerson } from "./lib/term-calendar.mjs";
import { parseWikiResults } from "./lib/election-results.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const ONLY = args.includes("--state") ? args[args.indexOf("--state") + 1]?.toUpperCase() : null;
const t0 = Date.now();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const CYCLE = Number(args.includes("--cycle") ? args[args.indexOf("--cycle") + 1] : new Date().getUTCFullYear() - (new Date().getUTCFullYear() % 2));
const ELECTION = electionDay(CYCLE);
const WINDOW_DAYS = 60;
const UA = "iKratomBot/1.0 (https://www.ikratom.org; contact@ikratom.org)";
const OPEN = ["on_ballot", "needs_review"];
const STATEWIDE_PAGE = {
  us_senate: "United States Senate elections",
  governor: "United States gubernatorial elections",
  lt_governor: "United States lieutenant gubernatorial elections",
  attorney_general: "United States attorney general elections",
  secretary_of_state: "United States secretary of state elections",
};

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function telemetry(status, notes, rows = 0) {
  if (DRY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: "election_results", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes: String(notes).slice(0, 500),
    });
  } catch { /* best-effort */ }
}

const closes = new Date(Date.parse(`${ELECTION}T00:00:00Z`) + WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
if (!FORCE && (today <= ELECTION || today > closes)) {
  const why = today <= ELECTION ? `before results (${ELECTION})` : `window closed ${closes}`;
  console.log(`election results ${CYCLE}: ${why}`);
  await telemetry("empty", why);
  process.exit(0);
}

const seats = [];
for (let from = 0; ; from += 1000) {
  let q = sb.from("seat_elections").select("id, state, office, district, seat, kind, incumbent_name, winner_name, result_sources, status, review_reason")
    .eq("election_date", ELECTION).in("status", OPEN).order("id").range(from, from + 999);
  if (ONLY) q = q.eq("state", ONLY);
  const { data, error } = await q;
  if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
  seats.push(...data);
  if (data.length < 1000) break;
}
if (seats.length === 0) { console.log("no open seats"); await telemetry("empty", "no open seats"); process.exit(0); }

const pages = new Map(); // title list key -> Map | null
async function results(titles, mode) {
  const k = `${mode}:${titles[0]}`;
  if (pages.has(k)) return pages.get(k);
  let found = null;
  for (const title of titles) {
    try {
      const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) });
      const j = await r.json();
      if (j.parse?.text) { found = parseWikiResults(j.parse.text, mode); if (found.size) break; }
    } catch { /* next title */ }
    await new Promise((res) => setTimeout(res, 300));
  }
  pages.set(k, found);
  return found;
}

function lookup(seat) {
  if (seat.office === "state_senate" || seat.office === "state_house") {
    return { titles: wikiTitles(CYCLE, STATE_NAMES[seat.state], seat.office), mode: "district", key: normalizeDistrict(seat.district) ?? seat.district.toLowerCase() };
  }
  if (seat.office === "us_house") return { titles: [`${CYCLE} United States House of Representatives elections`], mode: "state-district", key: `${seat.state}-${seat.district}` };
  if (STATEWIDE_PAGE[seat.office]) return { titles: [`${CYCLE} ${STATEWIDE_PAGE[seat.office]}`], mode: "state", key: seat.state };
  return null;
}

let sightings = 0, finalized = 0, changed = 0, noResult = 0, noPage = 0, failed = 0;
const errors = [];
for (const seat of seats) {
  const where = lookup(seat);
  if (!where) continue;
  const map = await results(where.titles, where.mode);
  if (!map) { noPage++; continue; }
  const rows = (map.get(where.key) ?? []).filter((r) => r.incumbent);
  let decision = null, winner = null;
  if (seat.seat) {
    // Multi-member district: decided only when every row in it names a winner.
    if (rows.length && rows.every((r) => r.winners.length)) {
      const all = [...new Set(rows.flatMap((r) => r.winners))];
      if (all.some((w) => samePerson(w, seat.incumbent_name))) { decision = "incumbent_reelected"; winner = seat.incumbent_name; }
      else { decision = "successor_elected"; winner = all.filter((w) => !rows.some((r) => sameSurname(w, r.incumbent))).join(", ") || all.join(", "); }
    }
  } else {
    const mine = rows.filter((r) => sameSurname(r.incumbent, seat.incumbent_name));
    const w = mine.length === 1 ? mine[0].winners : [];
    if (w.length) {
      if (w.some((x) => samePerson(x, seat.incumbent_name))) { decision = "incumbent_reelected"; winner = seat.incumbent_name; }
      else if (w.some((x) => sameSurname(x, seat.incumbent_name))) { decision = "ambiguous"; winner = w[0]; }
      else { decision = "successor_elected"; winner = w[0]; }
    }
  }
  if (!decision) { noResult++; continue; }
  if (decision === "ambiguous") {
    // Same surname, different first initial: a relative, a successor who shares
    // the name, or a nickname. Never announce a departure on that.
    if (!DRY && seat.status !== "needs_review") await sb.from("seat_elections").update({ status: "needs_review", winner_name: winner, updated_at: new Date().toISOString(),
      review_reason: `winner ${winner} shares the incumbent's surname (${seat.incumbent_name}); confirm who won` }).eq("id", seat.id).in("status", OPEN);
    changed++;
    continue;
  }

  const prior = (seat.result_sources ?? []).filter((s) => s.startsWith("wikipedia:"));
  const priorDays = prior.map((s) => s.slice("wikipedia:".length));
  const tag = `wikipedia:${today}`;
  let patch;
  if (seat.winner_name && samePerson(seat.winner_name, winner) && priorDays.some((d) => d < today)) {
    patch = { status: decision, winner_name: winner, result_sources: [...new Set([...prior, tag])], review_reason: null };
    finalized++;
    console.log(`  ✓ ${seat.state} ${seat.office} ${seat.district}: ${decision === "incumbent_reelected" ? `${seat.incumbent_name} re-elected` : `${winner} succeeds ${seat.incumbent_name}`}`);
  } else if (seat.winner_name && !samePerson(seat.winner_name, winner)) {
    patch = { status: "needs_review", winner_name: winner, result_sources: [tag], review_reason: `result changed between readings: ${seat.winner_name}, then ${winner}` };
    changed++;
  } else if (!priorDays.includes(today)) {
    patch = { winner_name: winner, result_sources: [...new Set([...prior, tag])] };
    sightings++;
  } else continue;

  if (!DRY) {
    const { error } = await sb.from("seat_elections").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", seat.id).in("status", OPEN);
    if (error) { failed++; if (errors.length < 5) errors.push(`${seat.id}: ${error.message}`); }
  }
}
for (const e of errors) console.log(`  ✗ ${e}`);
const summary = `${DRY ? "DRY " : ""}${CYCLE}: ${seats.length} open seats · first sightings ${sightings} · confirmed ${finalized} · changed between readings ${changed} · no result yet ${noResult} · no page ${noPage} · failed ${failed}`;
console.log(summary);
await telemetry(failed ? "error" : sightings + finalized + changed ? "success" : "empty", summary, sightings + finalized + changed);
if (failed) process.exit(1);

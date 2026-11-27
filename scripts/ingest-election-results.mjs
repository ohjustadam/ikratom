/**
 * ingest-election-results.mjs — who won each seat on the ballot. The
 * officials-turnover engine, part (c) (private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md §1).
 *
 * For every open seat_elections row (on_ballot / needs_review) of the cycle's
 * general election, reads the winner from the Wikipedia election article for
 * that chamber (state legislatures), the U.S. House page, or the single-race
 * articles for U.S. Senate and statewide offices
 * (scripts/lib/election-results.mjs), matched on the district AND the
 * incumbent's surname, so a row about an earlier special election for the same
 * district never stands in for this one. Florida and Minnesota seats read the
 * state's own results files first.
 *
 * A reading changes nothing on the day it is first seen. It is stored as a
 * sighting (winner_name + "<source>:<day>") and the seat's status moves only
 * when a LATER day's reading names the same winner: a vandalised or premature
 * call has to survive a day to land. Then:
 *   - the incumbent won         → incumbent_reelected
 *   - someone else won          → successor_elected: the profile says
 *     "Leaving office on <handover day>", and the official stays active and
 *     contactable until turnover-swap.mjs confirms the successor from a
 *     second, independent roster source on or after that day.
 * A reading that changes between days is filed needs_review with both names.
 *
 * A seat already called is re-read every day too, because pages keep being
 * corrected for weeks (GA House 154 and Utah House 25 and 66 changed winner
 * after two matching readings, 2026-11). One whose source now names someone
 * else goes back to needs_review with today's reading, and confirms on the
 * next day that agrees; a corrected spelling only updates the winner's name,
 * which turnover-swap matches on. Seats reviewed by hand are left alone. More
 * than MAX_REFILE changes in one run is a parser fault, so none are filed.
 *
 * Runs daily (cron-daily roster-diff job); does nothing before election day
 * and stops 60 days after it. Telemetry: scraper_runs source "election_results".
 *
 *   node --env-file=.env.local scripts/ingest-election-results.mjs --dry-run
 *   node --env-file=.env.local scripts/ingest-election-results.mjs --force --state OK   # skip the date gate
 *   node --env-file=.env.local scripts/ingest-election-results.mjs --audit   # re-read DECIDED seats, list disagreements
 *
 * --audit never writes. It re-reads every seat already called (re-elected,
 * successor elected, or held for the swap) with today's parser and prints each
 * one whose stored result the sources no longer support. A parser fix only
 * helps open seats, so run it after any change to the reader.
 */
import { createClient } from "@supabase/supabase-js";
import { STATE_NAMES } from "./lib/us-states.mjs";
import { electionDay, normalizeDistrict, wikiTitles, sameSurname, samePerson, nearlySamePerson } from "./lib/term-calendar.mjs";
import { parseWikiResults, parseInfoboxResult, parseFloridaResults, parseMinnesotaResults, districtKey, decideSeat } from "./lib/election-results.mjs";

const args = process.argv.slice(2);
const AUDIT = args.includes("--audit");
const DRY = args.includes("--dry-run") || AUDIT;
const FORCE = args.includes("--force");
const ONLY = args.includes("--state") ? args[args.indexOf("--state") + 1]?.toUpperCase() : null;
const t0 = Date.now();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const CYCLE = Number(args.includes("--cycle") ? args[args.indexOf("--cycle") + 1] : new Date().getUTCFullYear() - (new Date().getUTCFullYear() % 2));
const ELECTION = electionDay(CYCLE);
// Long enough to outlast the last handover: Illinois and Maryland seat their
// legislatures on Jan 13 and Maryland's lieutenant governor on Jan 20, and the
// big chambers' pages fill in slowly (2026: Pennsylvania's 203 House seats were
// still unread at day 24). Day 60 (Jan 2) would have stopped short of them.
const WINDOW_DAYS = 100;
const UA = "iKratomBot/1.0 (https://www.ikratom.org; contact@ikratom.org)";
const OPEN = ["on_ballot", "needs_review"];
const DECIDED = ["incumbent_reelected", "successor_elected"];
const MAX_REFILE = 40; // called seats sent back to review in one run; more means the parser broke
const STATEWIDE_PAGE = {
  us_senate: "United States Senate elections",
  governor: "United States gubernatorial elections",
  lt_governor: "United States lieutenant gubernatorial elections",
  attorney_general: "United States attorney general elections",
  secretary_of_state: "United States secretary of state elections",
};
// The single-race article per state, whose infobox names the winner. The
// national pages above give statewide offices only "Stitt 55.4% R" (0 of 36
// governors read on the 2022 page), so these come first.
const STATE_RACE_PAGE = {
  us_senate: (s) => `${CYCLE} United States Senate election in ${s}`,
  governor: (s) => `${CYCLE} ${s} gubernatorial election`,
  lt_governor: (s) => `${CYCLE} ${s} lieutenant gubernatorial election`,
  attorney_general: (s) => `${CYCLE} ${s} Attorney General election`,
  secretary_of_state: (s) => `${CYCLE} ${s} Secretary of State election`,
};
// States that publish a results file anyone can read. Others sit behind apps or
// bot walls, so they wait for Wikipedia. U.S. House seats stay on Wikipedia: it
// lists the incumbent, and our roster shortens some names.
const DAY = ELECTION.replaceAll("-", "");
const OFFICIAL = {
  FL: {
    source: "fl-doe", parse: parseFloridaResults, offices: ["state_house", "state_senate", "us_senate"],
    urls: [`https://flelectionfiles.floridados.gov/enightfilespublic/${DAY}_ElecResultsFL.txt`],
  },
  MN: {
    source: "mn-sos", parse: parseMinnesotaResults, offices: ["state_house", "state_senate"],
    urls: [`https://electionresultsfiles.sos.mn.gov/${DAY}/stsenate.txt`, `https://electionresultsfiles.sos.mn.gov/${DAY}/LegislativeByDistrict.txt`],
  },
};
const READING = new RegExp(`^(?:wikipedia|${Object.values(OFFICIAL).map((o) => o.source).join("|")}):`);
const readings = (sources) => (sources ?? []).filter((s) => READING.test(s));
const wikiDays = (sources) => new Set(readings(sources).map((s) => s.split(":")[1]));

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

const byHand = (s) => (s.result_sources ?? []).some((x) => x.startsWith("reviewed:"));

/** The result a seat stands on: its status, or for a seat held for the swap, the call it was held with. */
function calledAs(s) {
  if (DECIDED.includes(s.status)) return s.status;
  return s.status === "needs_review" && s.winner_name && wikiDays(s.result_sources).size >= 2 ? "successor_elected" : null;
}

const seats = [];
for (let from = 0; ; from += 1000) {
  let q = sb.from("seat_elections").select("id, state, office, district, seat, kind, incumbent_name, winner_name, result_sources, status, review_reason")
    .eq("election_date", ELECTION).in("status", [...OPEN, ...DECIDED]).order("id").range(from, from + 999);
  if (ONLY) q = q.eq("state", ONLY);
  const { data, error } = await q;
  if (error) { await telemetry("error", `read: ${error.message}`); throw error; }
  // A needs_review row whose winner was already read on two days is not this
  // stage's any more: turnover-swap filed it (handover passed, no second
  // source yet). Re-reading it would flip it back to successor_elected each
  // morning and empty the admin queue the swap just filled.
  // Open seats, plus called ones to re-check. A needs_review row held for the
  // swap counts as called, so the open path never flips it back each morning.
  seats.push(...data.filter((s) => AUDIT ? calledAs(s) : calledAs(s) ? !byHand(s) : OPEN.includes(s.status)));
  if (data.length < 1000) break;
}
if (seats.length === 0) { console.log("no open seats"); await telemetry("empty", "no open seats"); process.exit(0); }

const pages = new Map(); // title list key -> Map | null
async function results(titles, mode, key) {
  const k = `${mode}:${titles[0]}`;
  if (pages.has(k)) return pages.get(k);
  let found = null;
  if (mode === "official") {
    const { urls, parse } = OFFICIAL[titles[0]];
    try {
      const files = await Promise.all(urls.map(async (u) => {
        const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) });
        if (!r.ok) throw new Error(String(r.status));
        return r.text();
      }));
      found = parse(files.join("\n"));
    } catch { /* Wikipedia still reads the seat */ }
    pages.set(k, found);
    return found;
  }
  for (const title of titles) {
    try {
      const r = await fetch(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) });
      const j = await r.json();
      if (mode === "infobox") {
        const box = j.parse?.text ? parseInfoboxResult(j.parse.text) : null;
        found = box ? new Map([[key, [box]]]) : null;
        if (found) break;
      } else if (j.parse?.text) { found = parseWikiResults(j.parse.text, mode); if (found.size) break; }
    } catch { /* next title */ }
    await new Promise((res) => setTimeout(res, 300));
  }
  pages.set(k, found);
  return found;
}

/** Where a seat's result is read, best source first. */
function lookups(seat) {
  const file = OFFICIAL[seat.state];
  const official = file?.offices.includes(seat.office)
    ? [{ titles: [seat.state], mode: "official", key: `${seat.office}-${(seat.district ?? "").toLowerCase()}`, source: file.source }] : [];
  if (seat.office === "state_senate" || seat.office === "state_house") {
    return [...official, { titles: wikiTitles(CYCLE, STATE_NAMES[seat.state], seat.office), mode: "district", key: normalizeDistrict(seat.district) ?? districtKey(seat.district) }];
  }
  if (seat.office === "us_house") return [...official, { titles: [`${CYCLE} United States House of Representatives elections`], mode: "state-district", key: `${seat.state}-${seat.district}` }];
  const out = [...official];
  if (seat.office === "us_senate" && seat.kind === "special") out.push({ titles: [`${CYCLE} United States Senate special election in ${STATE_NAMES[seat.state]}`], mode: "infobox", key: seat.state });
  if (STATE_RACE_PAGE[seat.office]) out.push({ titles: [STATE_RACE_PAGE[seat.office](STATE_NAMES[seat.state])], mode: "infobox", key: seat.state });
  if (STATEWIDE_PAGE[seat.office]) out.push({ titles: [`${CYCLE} ${STATEWIDE_PAGE[seat.office]}`], mode: "state", key: seat.state });
  return out;
}

/** Who won the chamber's other districts in this state: an incumbent found here moved, not left. */
function otherWinners(map, w, seat) {
  if (w.mode === "infobox" || w.mode === "state") return [];
  const same = w.mode === "state-district" ? `${seat.state}-` : w.mode === "official" ? `${seat.office}-` : "";
  return [...map].filter(([k]) => k !== w.key && k.startsWith(same)).flatMap(([, rows]) => rows.flatMap((r) => r.winners));
}

let sightings = 0, finalized = 0, changed = 0, noResult = 0, noPage = 0, failed = 0, disagree = 0, agree = 0, rechecked = 0;
const refile = [], respell = [];
const errors = [];
for (const seat of seats) {
  const where = lookups(seat);
  if (!where.length) continue;
  let rows = [], anyPage = false, source = "wikipedia", elsewhere = [];
  for (const w of where) {
    const map = await results(w.titles, w.mode, w.key);
    if (!map) continue;
    anyPage = true;
    elsewhere = otherWinners(map, w, seat);
    rows = (map.get(w.key) ?? []).filter((r) => r.incumbent || r.box);
    // A national page lists the governor on the lieutenant governor's row, and
    // a running mate's page redirects to the governor's race, so a row in
    // either counts only when it names our incumbent.
    if (w.mode === "state" || seat.office === "lt_governor") rows = rows.filter((r) => sameSurname(r.incumbent, seat.incumbent_name));
    source = w.source ?? "wikipedia";
    if (rows.some((r) => r.winners.length)) break;
  }
  if (!anyPage) { noPage++; continue; }
  const { decision, winner, reason } = decideSeat(seat, rows, elsewhere);
  if (!decision) {
    if (!AUDIT && calledAs(seat)) continue; // a called seat no source reads today keeps its call
    noResult++;
    if (AUDIT) console.log(`  ~ ${seat.id.slice(0, 8)} ${seat.state} ${seat.office} ${seat.district}: stored ${calledAs(seat)} ${seat.winner_name}; no source reads it now`);
    continue;
  }
  if (AUDIT) {
    const was = calledAs(seat);
    if (decision === was && samePerson(seat.winner_name ?? "", winner)) { agree++; continue; }
    disagree++;
    const reviewed = (seat.result_sources ?? []).some((s) => s.startsWith("reviewed:")) ? " [hand-reviewed]" : "";
    console.log(`  ! ${seat.id.slice(0, 8)} ${seat.state} ${seat.office} ${seat.district}: stored ${was} ${seat.winner_name}; reads ${decision} ${winner ?? ""} (${source})${reviewed}${reason ? ` — ${reason}` : ""}`);
    continue;
  }
  const was = calledAs(seat);
  if (was) {
    rechecked++;
    if (decision === was && samePerson(seat.winner_name ?? "", winner)) continue;
    if (decision === was && nearlySamePerson(seat.winner_name ?? "", winner)) respell.push({ seat, winner });
    else refile.push({ seat, was, decision, winner, source, reason });
    continue;
  }
  if (decision === "ambiguous") {
    // A relative, a successor who shares the name, a nickname, or a roster that
    // has fallen behind. Never announce a departure on that.
    if (DRY) console.log(`  ? ${seat.state} ${seat.office} ${seat.district}: ${seat.incumbent_name} -> ${winner}`);
    if (!DRY && seat.status !== "needs_review") await sb.from("seat_elections").update({ status: "needs_review", winner_name: winner, updated_at: new Date().toISOString(),
      review_reason: reason }).eq("id", seat.id).in("status", OPEN);
    changed++;
    continue;
  }

  const prior = readings(seat.result_sources);
  const priorDays = prior.map((s) => s.split(":")[1]);
  const tag = `${source}:${today}`;
  let patch;
  if (seat.winner_name && samePerson(seat.winner_name, winner) && priorDays.some((d) => d < today)) {
    patch = { status: decision, winner_name: winner, result_sources: [...new Set([...prior, tag])], review_reason: null };
    finalized++;
    console.log(`  ✓ ${seat.state} ${seat.office} ${seat.district}: ${decision === "incumbent_reelected" ? `${seat.incumbent_name} re-elected` : `${winner} succeeds ${seat.incumbent_name}`}`);
  } else if (seat.winner_name && !samePerson(seat.winner_name, winner) && source !== "wikipedia" && !prior.some((s) => s.startsWith(`${source}:`))) {
    // The state's own file outranks a Wikipedia table, typos included: start over from it.
    patch = { winner_name: winner, result_sources: [tag] };
    sightings++;
  } else if (seat.winner_name && !samePerson(seat.winner_name, winner)) {
    patch = { status: "needs_review", winner_name: winner, result_sources: [tag], review_reason: `result changed between readings: ${seat.winner_name}, then ${winner}` };
    changed++;
  } else if (!priorDays.includes(today)) {
    patch = { winner_name: winner, result_sources: [...new Set([...prior, tag])] };
    sightings++;
  } else continue;

  if (DRY) console.log(`  · ${seat.state} ${seat.office} ${seat.district}: ${seat.incumbent_name} -> ${winner} [${patch.status ?? "sighting"}/${decision}/${source}]`);
  if (!DRY) {
    const { error } = await sb.from("seat_elections").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", seat.id).in("status", OPEN);
    if (error) { failed++; if (errors.length < 5) errors.push(`${seat.id}: ${error.message}`); }
  }
}
let refiled = 0, respelled = 0, held = 0;
if (refile.length > MAX_REFILE) {
  held = refile.length;
  console.log(`  ✗ ${held} called seats read differently today; more than ${MAX_REFILE} means a parser fault, so none were re-filed`);
} else for (const r of refile) {
  const now = r.decision === "ambiguous" ? `an unclear result (${r.reason})` : `${r.decision} ${r.winner}`;
  console.log(`  ↺ ${r.seat.state} ${r.seat.office} ${r.seat.district}: called ${r.was} ${r.seat.winner_name}; ${r.source} now reads ${now}`);
  if (DRY) { refiled++; continue; }
  // A definite new reading is today's sighting; tomorrow's agreeing read confirms it.
  const { error } = await sb.from("seat_elections").update({
    status: "needs_review", updated_at: new Date().toISOString(),
    winner_name: r.decision === "ambiguous" ? r.seat.winner_name : r.winner,
    result_sources: r.decision === "ambiguous" ? [] : [`${r.source}:${today}`],
    review_reason: `called ${r.was === "incumbent_reelected" ? "re-elected" : "successor elected"} (${r.seat.winner_name}), but ${r.source} now reads ${now}`.slice(0, 500),
  }).eq("id", r.seat.id).eq("status", r.seat.status);
  if (error) { failed++; if (errors.length < 5) errors.push(`${r.seat.id}: ${error.message}`); } else refiled++;
}
for (const r of respell) {
  console.log(`  ✎ ${r.seat.state} ${r.seat.office} ${r.seat.district}: ${r.seat.winner_name} is spelled ${r.winner}`);
  if (DRY) { respelled++; continue; }
  const { error } = await sb.from("seat_elections").update({ winner_name: r.winner, updated_at: new Date().toISOString() }).eq("id", r.seat.id).eq("status", r.seat.status);
  if (error) failed++; else respelled++;
}
for (const e of errors) console.log(`  ✗ ${e}`);
if (AUDIT) { console.log(`AUDIT ${CYCLE}: ${seats.length} called seats · still supported ${agree} · disagree ${disagree} · no reading now ${noResult} · no page ${noPage}`); process.exit(0); }
const summary = `${DRY ? "DRY " : ""}${CYCLE}: ${seats.length - rechecked} open seats · first sightings ${sightings} · confirmed ${finalized} · changed between readings ${changed} · no result yet ${noResult} · no page ${noPage} · called seats re-read ${rechecked}, re-filed ${refiled}, respelled ${respelled}${held ? `, ${held} HELD` : ""} · failed ${failed}`;
console.log(summary);
await telemetry(failed || held ? "error" : sightings + finalized + changed + refiled + respelled ? "success" : "empty", summary, sightings + finalized + changed + refiled + respelled);
if (failed) process.exit(1);

/**
 * sync-seat-watch.mjs — which seats are on the next general-election ballot,
 * and when each one changes hands. The officials-turnover engine, parts (a)
 * and (b) (private/plans/OFFICIALS_TURNOVER_ELECTIONS_GROUPS.md §1).
 *
 * Writes two tables (migration 0277):
 *   term_calendar  — per state chamber: seats up (NCSL), the handover day
 *                    (a rule proven against two observed cycles of
 *                    openstates/people start dates, scripts/lib/term-calendar.mjs),
 *                    and whether the seat list is verified. Plus Congress.
 *   seat_elections — one row per sitting official whose seat is on the
 *                    ballot (status on_ballot), the flag behind the
 *                    "on the Nov 3 ballot" profile banner.
 * and fills legislators.term_end_date for state legislators whose seats are
 * up, from the SEAT's handover day — never from start date + term length,
 * which is wrong for every appointee.
 *
 * Which seats are up, per chamber:
 *   - NCSL says every seat (or none): decided by the count alone.
 *   - Staggered chambers (27 senates + the ND house): the district list on
 *     the chamber's Wikipedia election article, accepted only when its seat
 *     count equals NCSL's. A listed district whose incumbent's surname does
 *     not match ours is filed needs_review rather than trusted. A chamber
 *     whose list cannot be verified gets no seat rows and is left
 *     'unverified' in term_calendar for the admin queue.
 *   - Congress: the term end congress-legislators publishes (exact) — every
 *     term ending by the next Jan 3 is on this ballot; one ending earlier is
 *     a special election (an appointee's seat).
 *   - Statewide executives: a sourced term_end_date between election day and
 *     the end of March after it.
 *
 * Never touches a row past on_ballot/needs_review: once results are in
 * (ingest-election-results.mjs) the ledger belongs to that stage and the swap.
 *
 * Self-gates to every 3 days (the seat list barely moves pre-election);
 * --force overrides. Telemetry: scraper_runs source "seat_watch".
 *
 *   node --env-file=.env.local scripts/sync-seat-watch.mjs --dry-run --force
 *   node --env-file=.env.local scripts/sync-seat-watch.mjs --force --state OK
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball, toIsoDay } from "./lib/openstates-people.mjs";
import { STATE_NAMES } from "./lib/us-states.mjs";
import {
  electionDay, addDays, applyRule, deriveStateTermStarts, parseNcslRaces, NCSL_RACES_URL,
  parseWikiSeatTables, wikiTitles, rowNamesOfficial,
} from "./lib/term-calendar.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const ONLY = args.includes("--state") ? args[args.indexOf("--state") + 1]?.toUpperCase() : null;
const t0 = Date.now();
const today = new Date().toISOString().slice(0, 10);
const CYCLE = Number(args.includes("--cycle") ? args[args.indexOf("--cycle") + 1] : new Date().getUTCFullYear() + (new Date().getUTCFullYear() % 2));
const ELECTION = electionDay(CYCLE);
const OBS_CYCLES = [CYCLE - 10, CYCLE - 8, CYCLE - 6, CYCLE - 4, CYCLE - 2];
const UA = "iKratomBot/1.0 (https://www.ikratom.org; contact@ikratom.org)";
const GATE_DAYS = 3;
const MAX_NAME_MISMATCH = 0.2; // above this share, the page or table is wrong, not the incumbents

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function telemetry(status, notes, rows = 0) {
  if (DRY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: "seat_watch", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rows, notes: String(notes).slice(0, 500),
    });
  } catch { /* best-effort */ }
}

async function fail(msg) { console.error(msg); await telemetry("error", msg); process.exit(1); }

if (!FORCE) {
  const { data: last } = await sb.from("scraper_runs").select("finished_at").eq("source", "seat_watch")
    .in("status", ["success", "empty"]).order("finished_at", { ascending: false }).limit(1);
  const ageDays = last?.[0] ? (Date.now() - Date.parse(last[0].finished_at)) / 86_400_000 : Infinity;
  if (ageDays < GATE_DAYS) { console.log(`seat watch ran ${ageDays.toFixed(1)}d ago; next run after ${GATE_DAYS}d (--force to run now)`); process.exit(0); }
}
if (today > ELECTION) {
  // After election day the ballot is settled; results ingestion takes over.
  console.log(`cycle ${CYCLE}: election ${ELECTION} has passed; nothing to watch`);
  await telemetry("empty", `election ${ELECTION} passed`);
  process.exit(0);
}

// ── Sources ────────────────────────────────────────────────────────────────
console.log(`seat watch ${CYCLE} (election ${ELECTION})${DRY ? " — DRY RUN" : ""}`);
const ncslRes = await fetch(NCSL_RACES_URL, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60_000) }).catch((e) => ({ ok: false, status: e.message }));
if (!ncslRes.ok) await fail(`NCSL ${ncslRes.status}`);
const ncsl = parseNcslRaces(await ncslRes.text());
if (ncsl.size < 45) await fail(`NCSL table parsed only ${ncsl.size} states`);

console.log("downloading openstates/people…");
const PATH_RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/(?:legislature|retired)\/[^/]+\.ya?ml$/i;
let files;
try { files = await collectFromTarball(PEOPLE_TARBALL, PATH_RE); } catch (e) { await fail(`openstates tarball: ${e.message}`); }
const starts = {}; // state -> { upper|lower|legislature -> [iso] }
for (const [p, txt] of files) {
  const st = p.match(PATH_RE)[1].toUpperCase();
  let doc; try { doc = yaml.load(txt); } catch { continue; }
  for (const r of doc?.roles ?? []) {
    if (!["upper", "lower", "legislature"].includes(r?.type)) continue;
    ((starts[st] ??= {})[r.type] ??= []).push(toIsoDay(r.start_date));
  }
}

const { data: stateRows } = await sb.from("states").select("abbr");
const tracked = [...new Set((stateRows ?? []).map((s) => s.abbr))].filter((s) => STATE_NAMES[s] && (!ONLY || s === ONLY)).sort();

async function readAll(build, { optional = false } = {}) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order("id").range(from, from + 999);
    if (error && optional) { console.log(`  (read skipped: ${error.message})`); return out; }
    if (error) await fail(`read: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
const officials = await readAll(() => {
  let q = sb.from("legislators").select("id, state, level, role, district, full_name, term_end_date")
    .eq("active", true).in("level", ["state", "federal"]);
  return ONLY ? q.eq("state", ONLY) : q;
});

async function wikiSeats(stateName, office) {
  for (const title of wikiTitles(CYCLE, stateName, office)) {
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
      const j = await r.json();
      if (j.error || !j.parse?.text) continue;
      const seats = parseWikiSeatTables(j.parse.text);
      if (seats.regular.size === 0 && seats.special.size === 0) continue;
      return { ...seats, title: j.parse.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(j.parse.title.replace(/ /g, "_"))}` };
    } catch { /* try the next title */ }
    await new Promise((res) => setTimeout(res, 300));
  }
  return null;
}

// ── Build the calendar and the seat list ──────────────────────────────────
const calendar = [];
const seats = []; // { state, office, district, seat, kind, incumbent, handover, status, review_reason, sources_md }
const report = { all: 0, none: 0, listed: 0, unverified: [], noDate: [] };
const CHAMBERS = [["upper", "state_senate"], ["lower", "state_house"]];

for (const st of tracked) {
  const name = STATE_NAMES[st];
  const row = ncsl.get(name);
  if (!row) continue;
  const os = starts[st] ?? {};
  const derived = deriveStateTermStarts(st === "NE" ? { upper: os.legislature ?? [] } : { upper: os.upper ?? [], lower: os.lower ?? [] }, OBS_CYCLES, CYCLE);

  for (const [chamber, office] of CHAMBERS) {
    const n = row[chamber];
    if (!n) continue;
    const d = derived[chamber] ?? { date: null, reason: "no openstates roles" };
    const members = officials.filter((o) => o.level === "state" && o.state === st && o.role === office);
    const perDistrict = new Map();
    for (const m of members) perDistrict.set(m.district ?? "", (perDistrict.get(m.district ?? "") ?? 0) + 1);
    const multi = [...perDistrict.values()].some((c) => c > 1);
    const sources = [`- Seats up: NCSL, ${NCSL_RACES_URL}`];
    sources.push(d.date ? `- Handover ${d.date} (rule ${d.rule}): openstates/people — ${d.evidence}` : `- Handover unknown: ${d.reason}`);
    if (n.up > 0 && !d.date) report.noDate.push(`${st} ${office}`);

    let status;
    let chosen = []; // [{ member, kind, review }]
    if (n.up === 0) status = "none";
    else if (n.up >= n.total) {
      status = "all";
      chosen = members.map((m) => ({ member: m, kind: "regular" }));
    } else {
      const wiki = await wikiSeats(name, office);
      const seatsPer = members.length && perDistrict.size ? Math.round(members.length / perDistrict.size) : 1;
      const specialExtra = wiki ? [...wiki.special.keys()].filter((k) => !wiki.regular.has(k)).length : 0;
      // NCSL counts regularly scheduled seats; a page may or may not fold a
      // special into its main table. In a multi-member district either every
      // member is up (ND house: 2 per district) or ONE is (WV senate: 2 per
      // district, 1 up each cycle) — then the listed name says which.
      const fits = (per) => wiki && (wiki.regular.size * per === n.up || (wiki.regular.size + specialExtra) * per === n.up);
      const per = fits(seatsPer) ? seatsPer : fits(1) ? 1 : null;
      if (!per) {
        status = "unverified";
        const listed = wiki ? wiki.regular.size * seatsPer : 0;
        report.unverified.push(`${st} ${office}: ${wiki ? `Wikipedia lists ${listed} seats, NCSL ${n.up}` : "no Wikipedia seat table"}`);
        if (wiki) sources.push(`- Seat list REJECTED: ${wiki.url} lists ${listed}, NCSL says ${n.up}`);
      } else {
        const picks = [];
        let mismatches = 0;
        for (const [kind, list] of [["regular", wiki.regular], ["special", wiki.special]]) {
          for (const [district, row] of list) {
            if (kind === "special" && wiki.regular.has(district)) continue;
            const inDistrict = members.filter((x) => String(x.district) === district);
            if (per === 1 && seatsPer > 1) {
              // Only the named member's seat is up; nobody named → a vacancy or a stale row.
              const named = inDistrict.filter((m) => rowNamesOfficial(row, m.full_name));
              if (named.length === 1) picks.push({ member: named[0], kind });
              else mismatches++;
              continue;
            }
            for (const m of inDistrict) {
              const agree = seatsPer > 1 || !row.name || rowNamesOfficial(row, m.full_name);
              if (!agree) mismatches++;
              picks.push({ member: m, kind, review: agree ? null : `Wikipedia lists the incumbent as ${row.name}; our roster has ${m.full_name}` });
            }
          }
        }
        if (picks.length && mismatches / picks.length > MAX_NAME_MISMATCH) {
          status = "unverified";
          report.unverified.push(`${st} ${office}: ${mismatches}/${picks.length} incumbents disagree with ${wiki.url}`);
        } else {
          status = "listed";
          chosen = picks;
          sources.push(`- Seat list: ${wiki.url} (${wiki.regular.size} districts${wiki.special.size ? ` + ${wiki.special.size} special` : ""}; count matches NCSL)`);
        }
      }
    }
    if (status !== "unverified") report[status]++;

    calendar.push({
      state: st, office, cycle_year: CYCLE, election_date: ELECTION, term_years: n.termYears, total_seats: n.total,
      seats_up: n.up, seat_list_status: status, term_start_rule: d.date ? d.rule : null,
      new_term_starts: d.date ?? null, rule_evidence: d.date ? d.evidence : d.reason, sources_md: sources.join("\n"),
      synced_at: new Date().toISOString(),
    });
    for (const c of chosen) {
      seats.push({
        state: st, office, district: String(c.member.district ?? ""), seat: multi ? c.member.id : "",
        kind: c.kind, incumbent: c.member,
        // A special-election winner takes office on certification, not on the regular day.
        handover: c.kind === "regular" ? d.date ?? null : null,
        status: c.review ? "needs_review" : "on_ballot", review_reason: c.review ?? null, sources_md: sources.join("\n"),
      });
    }
  }
}

// Congress: the published term end decides it.
const fedEnd = `${CYCLE + 1}-01-03`;
for (const o of officials.filter((x) => x.level === "federal" && x.term_end_date && x.term_end_date <= fedEnd)) {
  seats.push({
    state: o.state, office: o.role, district: o.role === "us_house" ? String(o.district ?? "") : "", seat: o.role === "us_senate" ? o.id : "",
    kind: o.term_end_date < fedEnd ? "special" : "regular", incumbent: o, handover: o.term_end_date < fedEnd ? null : fedEnd,
    status: "on_ballot", review_reason: null, sources_md: "- Term end: unitedstates/congress-legislators (exact)",
  });
}
if (!ONLY) {
  for (const office of ["us_house", "us_senate"]) {
    const up = seats.filter((s) => s.office === office).length;
    calendar.push({
      state: "US", office, cycle_year: CYCLE, election_date: ELECTION, term_years: office === "us_house" ? 2 : 6,
      total_seats: office === "us_house" ? 435 : 100, seats_up: up, seat_list_status: "listed", term_start_rule: "fixed:01-03",
      new_term_starts: fedEnd, rule_evidence: "20th Amendment: terms begin at noon on January 3",
      sources_md: "- Seats up: members whose term ends by Jan 3, unitedstates/congress-legislators", synced_at: new Date().toISOString(),
    });
  }
}

// Statewide executives with a sourced term end in the window.
const execEnd = `${CYCLE + 1}-03-31`;
for (const o of officials.filter((x) => x.level === "state" && !["state_senate", "state_house"].includes(x.role) && x.term_end_date && x.term_end_date >= ELECTION && x.term_end_date <= execEnd)) {
  seats.push({
    state: o.state, office: o.role, district: "", seat: "", kind: "regular", incumbent: o, handover: o.term_end_date,
    status: "on_ballot", review_reason: null, sources_md: "- Term end: legislators.term_end_date (sync-state-executives)",
  });
}

// ── Diff against the ledger ───────────────────────────────────────────────
const existing = await readAll(() => {
  let q = sb.from("seat_elections").select("id, state, office, district, seat, kind, incumbent_id, status, handover_date, review_reason").eq("election_date", ELECTION);
  return ONLY ? q.eq("state", ONLY) : q;
}, { optional: DRY }); // a dry run may precede the migration
const keyOf = (s) => [s.state, s.office, s.district, s.seat, s.kind].join("|");
const byKey = new Map(existing.map((r) => [keyOf(r), r]));
const OPEN = new Set(["on_ballot", "needs_review"]);
const inserts = [], updates = [], cancels = [];
const seen = new Set();
for (const s of seats) {
  const k = keyOf(s);
  if (seen.has(k)) continue;
  seen.add(k);
  const cur = byKey.get(k);
  const fields = {
    incumbent_id: s.incumbent.id, incumbent_name: s.incumbent.full_name, handover_date: s.handover,
    status: s.status, review_reason: s.review_reason, sources_md: s.sources_md,
  };
  if (!cur) inserts.push({ state: s.state, office: s.office, district: s.district, seat: s.seat, election_date: ELECTION, kind: s.kind, ...fields });
  else if (OPEN.has(cur.status) && (cur.incumbent_id !== s.incumbent.id || cur.handover_date !== s.handover || cur.status !== s.status || cur.review_reason !== s.review_reason)) {
    updates.push({ id: cur.id, ...fields, updated_at: new Date().toISOString() });
  }
}
for (const r of existing) {
  if (!seen.has(keyOf(r)) && OPEN.has(r.status)) cancels.push(r.id); // incumbent left office, or the seat fell off the list
}

// term_end_date from the seat's handover day — only where we hold none.
const termFills = seats.filter((s) => s.kind === "regular" && s.status === "on_ballot" && s.handover
  && ["state_senate", "state_house"].includes(s.office) && !s.incumbent.term_end_date);
const termConflicts = seats.filter((s) => s.kind === "regular" && s.handover && ["state_senate", "state_house"].includes(s.office)
  && s.incumbent.term_end_date && s.incumbent.term_end_date !== s.handover);

console.log(`calendar ${calendar.length} rows · chambers all-up ${report.all}, listed ${report.listed}, unverified ${report.unverified.length}`);
console.log(`seats on ballot ${seen.size} (new ${inserts.length}, changed ${updates.length}, cancelled ${cancels.length}) · needs_review ${seats.filter((s) => s.status === "needs_review").length}`);
console.log(`term_end_date fills ${termFills.length} · conflicts left alone ${termConflicts.length}`);
for (const u of report.unverified) console.log(`  ? ${u}`);
if (report.noDate.length) console.log(`  no proven handover day: ${report.noDate.join(", ")}`);
for (const s of seats.filter((x) => x.status === "needs_review").slice(0, 15)) console.log(`  ! ${s.state} ${s.office} ${s.district}: ${s.review_reason}`);
for (const s of termConflicts.slice(0, 10)) console.log(`  ≠ ${s.state} ${s.incumbent.full_name}: has ${s.incumbent.term_end_date}, seat hands over ${s.handover}`);

let applied = 0, failed = 0;
const errors = [];
const note = (e, what) => { failed++; if (errors.length < 5) errors.push(`${what}: ${e.message}`); };
if (!DRY) {
  const { error: ce } = await sb.from("term_calendar").upsert(calendar, { onConflict: "state,office,cycle_year" });
  if (ce) note(ce, "calendar"); else applied += calendar.length;
  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await sb.from("seat_elections").insert(inserts.slice(i, i + 500));
    if (error) note(error, "insert"); else applied += Math.min(500, inserts.length - i);
  }
  for (const u of updates) {
    const { id, ...f } = u;
    const { error } = await sb.from("seat_elections").update(f).eq("id", id).in("status", [...OPEN]);
    if (error) note(error, "update"); else applied++;
  }
  if (cancels.length) {
    const { error } = await sb.from("seat_elections").update({ status: "cancelled", updated_at: new Date().toISOString() }).in("id", cancels).in("status", [...OPEN]);
    if (error) note(error, "cancel"); else applied += cancels.length;
  }
  // One update per distinct handover day; .is(null) keeps a sourced date we already hold.
  const byDay = new Map();
  for (const s of termFills) (byDay.get(s.handover) ?? byDay.set(s.handover, []).get(s.handover)).push(s.incumbent.id);
  for (const [day, ids] of byDay) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from("legislators").update({ term_end_date: day }).in("id", ids.slice(i, i + 200)).is("term_end_date", null);
      if (error) note(error, "term_end"); else applied += Math.min(200, ids.length - i);
    }
  }
}
for (const e of errors) console.log(`  ✗ ${e}`);
const summary = `${DRY ? "DRY " : ""}${CYCLE}: ${seen.size} seats on ballot (+${inserts.length} ~${updates.length} -${cancels.length}), ${termFills.length} term ends filled, `
  + `${report.unverified.length} chambers unverified${report.unverified.length ? ` [${report.unverified.map((u) => u.split(":")[0]).join(", ")}]` : ""}, `
  + `${report.noDate.length} without a handover day, failed ${failed}`;
console.log(summary);
await telemetry(failed > 0 ? "error" : applied > 0 ? "success" : "empty", summary, applied);
if (failed > 0) process.exit(1);

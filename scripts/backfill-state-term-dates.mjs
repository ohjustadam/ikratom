#!/usr/bin/env node
/**
 * backfill-state-term-dates.mjs — populate legislators.term_start_date (and
 * term_end_date where it is genuinely published) for the STATE tier, from the
 * keyless openstates/people roster.
 *
 * WHY. "When is this official's term up" is the backbone of election tracking
 * and of deciding whether pressure is worth applying before a term ends.
 * backfill-term-dates.mjs solved the FEDERAL tier exactly (530/531 via
 * bioguide_id). The state tier is 14x bigger and was almost entirely empty —
 * measured 2026-09-07:
 *
 *     state   7,537 active ·     0 with term_start_date  (0%)
 *                            ·   169 with term_end_date  (2%)
 *     of those, 7,368 (97.8%) carry an openstates_id
 *
 * WHAT THIS SOURCE ACTUALLY CARRIES — measured over the whole corpus, not
 * assumed. I expected openstates/people to publish full terms for state
 * legislators. It does not. Of 7,346 current state-legislature roles, 7,346
 * carry a start_date and SIX carry an end_date. A first sample suggested ~20%
 * had one; that sample was wrong twice over — the regex missed the "- " of a
 * YAML list item, and the path filter was swallowing `data/us/` (Congress),
 * whose members DO publish end dates. So: this fills term_start_date almost
 * everywhere, and term_end_date stays null at the state tier because the data
 * genuinely is not there.
 *
 * WHY term_end_date IS NOT DERIVED. It is tempting to compute it as
 * start_date + the state's term length. That is wrong for exactly the people
 * it matters most for. A legislator appointed to fill a vacancy — Aletia
 * Timmons (OK), sworn 2025-06-18 — does not serve four years from her start
 * date; she serves the REMAINDER of the seat's regular term. Deriving would
 * publish a confidently wrong date for every appointee and every special
 * election winner, and the UI states these as fact. Correct derivation needs
 * the seat's election cycle, not the person's start date. Left for the
 * elections table, where the cycle belongs.
 *
 * SAFETY. Join is exact on openstates_id (ocd-person/<uuid>) — never a name
 * match. The upstream chamber must agree with ours or the row is skipped and
 * reported: a disagreement means our record is wrong, and writing a Senate
 * term onto a House member is worse than leaving the field null.
 *
 *   node --env-file=.env.local scripts/backfill-state-term-dates.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-state-term-dates.mjs
 */
import { createClient } from "@supabase/supabase-js";
import yaml from "js-yaml";
import { PEOPLE_TARBALL, collectFromTarball, toIsoDay, currentRole } from "./lib/openstates-people.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const t0 = Date.now();
const NOW = () => new Date().toISOString();
const today = NOW().slice(0, 10);

// Only STATE legislature files. `data/us/legislature/` in this same repo is the
// US CONGRESS, and a bare [a-z]{2} swallows it: an early run counted 537
// members of Congress as state legislators. They happened not to match (our
// federal rows key on bioguide_id) so nothing was miswritten, but the tally was
// wrong and a future join on openstates_id would have crossed the tiers.
// Federal terms are handled exactly by backfill-term-dates.mjs.
const PATH_RE = /(?:^|\/)data\/(?!us\/)([a-z]{2})\/legislature\/[^/]+\.ya?ml$/i;

// openstates role type -> our legislators.role. Nebraska's unicameral body is
// "legislature" upstream and is filed as state_senate here (its members are
// senators), which matches how the rest of the platform already treats NE.
const ROLE_MAP = new Map([
  ["upper", "state_senate"],
  ["lower", "state_house"],
  ["legislature", "state_senate"],
]);
const WANT_TYPES = new Set(ROLE_MAP.keys());

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function record(status, notes, rows = 0) {
  try {
    await sb.from("scraper_runs").insert({
      source: "backfill_state_term_dates",
      started_at: new Date(t0).toISOString(),
      finished_at: NOW(),
      status, rows_updated: rows, notes: String(notes).slice(0, 300),
    });
  } catch { /* best-effort */ }
}

console.log(`state term dates: downloading openstates/people tarball…`);
let files;
try {
  files = await collectFromTarball(PEOPLE_TARBALL, PATH_RE);
} catch (e) {
  console.error(`tarball failed: ${e.message}`);
  await record("fail", `tarball: ${e.message}`);
  process.exit(1);
}
console.log(`  ${files.size} state legislature YAML files`);

// openstates_id -> { start, end, type }
const terms = new Map();
let noCurrentRole = 0;
for (const [, text] of files) {
  let doc;
  try { doc = yaml.load(text); } catch { continue; }
  if (!doc?.id) continue;
  const role = currentRole(doc, WANT_TYPES, today);
  if (!role) { noCurrentRole++; continue; }
  const start = toIsoDay(role.start_date);
  if (!start) continue;
  terms.set(String(doc.id), { start, end: toIsoDay(role.end_date), role: ROLE_MAP.get(String(role.type).toLowerCase()) });
}
console.log(`  ${terms.size} with a datable current role (${noCurrentRole} had no current role upstream)`);
const withEnd = [...terms.values()].filter((t) => t.end).length;
console.log(`  of those, ${withEnd} publish an end_date (${((withEnd / Math.max(terms.size, 1)) * 100).toFixed(0)}%) — the rest stay null rather than guessed\n`);

// Page through our state tier: PostgREST caps a single select at 1000 rows.
const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("legislators")
    .select("id, openstates_id, full_name, state, role, term_start_date, term_end_date")
    .eq("active", true).eq("level", "state")
    .not("openstates_id", "is", null)
    .order("id").range(from, from + 999);
  if (error) { console.error(error.message); await record("fail", error.message); process.exit(1); }
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log(`${rows.length} active state rows with an openstates_id\n`);

let startsSet = 0, endsSet = 0, already = 0, unmatched = 0, mismatch = 0, failed = 0;
const mismatches = [];
// Group identical patches so the writes are bulk, not one round trip per row.
// A whole intake class is sworn in on the same day, so 7,236 rows collapse to a
// couple of hundred distinct (start, end) pairs. Row-at-a-time took ~20 minutes
// against prod, which would not fit the weekly job's timeout on a cold DB, and
// spends egress we are short of.
const groups = new Map(); // "start|end" -> { patch, ids: [] }

for (const r of rows) {
  const t = terms.get(r.openstates_id);
  if (!t) { unmatched++; continue; }

  // Chamber sanity gate. The id is unique and stable, so a disagreement means
  // OUR row is wrong — report it, never overwrite on top of it.
  if (r.role && t.role && r.role !== t.role) {
    mismatch++;
    if (mismatches.length < 12) mismatches.push(`${r.state} ${r.full_name}: ours=${r.role} upstream=${t.role}`);
    continue;
  }

  const patch = {};
  if (r.term_start_date !== t.start) patch.term_start_date = t.start;
  // Only ever ADD an end date from upstream; never null out one we already
  // hold, since 169 rows were populated by other paths. Absence of the key in
  // the patch is what protects them — a null would overwrite.
  if (t.end && r.term_end_date !== t.end) patch.term_end_date = t.end;
  if (Object.keys(patch).length === 0) { already++; continue; }

  if (patch.term_start_date) startsSet++;
  if (patch.term_end_date) endsSet++;

  const key = `${patch.term_start_date ?? ""}|${patch.term_end_date ?? ""}`;
  if (!groups.has(key)) groups.set(key, { patch, ids: [] });
  groups.get(key).ids.push(r.id);
}

if (!DRY) {
  console.log(`writing ${groups.size} distinct patch group(s)…`);
  for (const { patch, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error } = await sb.from("legislators").update(patch).in("id", chunk);
      if (error) {
        failed += chunk.length;
        if (failed <= 400) console.log(`  x ${chunk.length} rows: ${error.message.slice(0, 70)}`);
      }
    }
  }
}

console.log(`${DRY ? "[DRY] would set" : "set"} term_start_date  ${startsSet}`);
console.log(`${DRY ? "[DRY] would set" : "set"} term_end_date    ${endsSet}`);
console.log(`already correct                    ${already}`);
console.log(`no upstream match                  ${unmatched}   (left null rather than guessed)`);
console.log(`chamber mismatch                   ${mismatch}   (our row disagrees with the roster)`);
if (failed) console.log(`write failures                     ${failed}`);
for (const m of mismatches) console.log(`  ! ${m}`);

if (!DRY) {
  await record(
    failed > 0 && startsSet === 0 ? "fail" : startsSet + endsSet > 0 ? "success" : "empty",
    `state: ${startsSet} starts, ${endsSet} ends, ${already} already correct, ${unmatched} unmatched, ${mismatch} chamber-mismatch, ${failed} failed`,
    startsSet + endsSet,
  );
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

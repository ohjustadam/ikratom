#!/usr/bin/env node
/**
 * backfill-term-dates.mjs — populate legislators.term_start_date /
 * term_end_date from keyless public sources.
 *
 * WHY. "When is this official's term up" is the backbone of election tracking,
 * and it was effectively absent: measured 2026-09-06,
 *
 *     federal    531 active ·   0 with term_end  (0%)
 *     state    7,537 active · 169 with term_end  (2%)
 *     county     349 active ·  64                (18%)
 *     municipal  902 active · 194                (22%)
 *     term_start_date: 0 rows, at every level
 *
 * Without it the platform cannot answer the two questions an advocate actually
 * asks — "is this person facing voters soon?" and "is pressure worth applying
 * before the term ends?" — and it cannot build an election calendar at all.
 *
 * FEDERAL is solved exactly, not approximately. unitedstates/congress-legislators
 * publishes current terms as keyless JSON (no key, no quota, same family of
 * source as the openstates/people tarball already used for portraits), all 539
 * entries carry start and end, and 100% of our federal rows have a bioguide_id
 * — so this is an exact join, never a name guess.
 *
 * STATE/LOCAL are not covered here. openstates/people carries role dates for
 * much of the state tier and is the obvious next pass; county and municipal
 * terms mostly are not published in any machine-readable feed and will need the
 * locality pipeline. Doing federal exactly is worth more than doing everything
 * fuzzily — a wrong term date is worse than a missing one, because the UI would
 * state it as fact.
 *
 *   node --env-file=.env.local scripts/backfill-term-dates.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-term-dates.mjs
 */
import { createClient } from "@supabase/supabase-js";

const SRC = "https://unitedstates.github.io/congress-legislators/legislators-current.json";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const t0 = Date.now();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

console.log(`Fetching ${SRC}`);
const res = await fetch(SRC, { signal: AbortSignal.timeout(90_000) });
if (!res.ok) { console.error(`source ${res.status}`); process.exit(1); }
const upstream = await res.json();
console.log(`  ${upstream.length} current federal legislators upstream`);

// bioguide -> latest term
const terms = new Map();
for (const p of upstream) {
  const bio = p.id?.bioguide;
  const t = p.terms?.[p.terms.length - 1];
  if (!bio || !t?.start || !t?.end) continue;
  terms.set(bio, { start: t.start, end: t.end, type: t.type, state: t.state });
}
console.log(`  ${terms.size} with a complete current term`);

const { data: rows, error } = await sb
  .from("legislators")
  .select("id, bioguide_id, full_name, state, role, term_start_date, term_end_date")
  .eq("active", true)
  .eq("level", "federal")
  .not("bioguide_id", "is", null)
  .limit(2000);
if (error) { console.error(error.message); process.exit(1); }
console.log(`  ${rows.length} active federal rows in our DB\n`);

let updated = 0, already = 0, unmatched = 0, mismatch = 0;

for (const r of rows) {
  const t = terms.get(r.bioguide_id);
  if (!t) { unmatched++; continue; }

  // Sanity gate: the upstream chamber must agree with ours. A bioguide id is
  // stable and unique, so a disagreement means our row is wrong, not the feed —
  // and writing a Senate term onto a House member would be worse than leaving
  // the field null. Report, never guess.
  const expectRole = t.type === "sen" ? "us_senate" : "us_house";
  if (r.role && r.role !== expectRole) {
    mismatch++;
    console.log(`  ⚠ ${r.full_name}: our role=${r.role} but upstream says ${expectRole} — skipped`);
    continue;
  }

  if (r.term_start_date === t.start && r.term_end_date === t.end) { already++; continue; }
  if (DRY) { updated++; continue; }

  const { error: upErr } = await sb
    .from("legislators")
    .update({ term_start_date: t.start, term_end_date: t.end })
    .eq("id", r.id);
  if (upErr) console.log(`  ⚠ ${r.full_name}: ${upErr.message.slice(0, 60)}`);
  else updated++;
}

console.log(`\n${DRY ? "[DRY] would update" : "updated"} ${updated}`);
console.log(`already correct   ${already}`);
console.log(`no upstream match ${unmatched}   (left null rather than guessed)`);
console.log(`chamber mismatch  ${mismatch}`);

if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "backfill_term_dates",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: updated > 0 ? "success" : "empty",
      rows_updated: updated,
      notes: `federal: ${updated} updated, ${already} already correct, ${unmatched} unmatched, ${mismatch} chamber-mismatch`,
    });
  } catch { /* best-effort */ }
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

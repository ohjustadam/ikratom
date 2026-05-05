#!/usr/bin/env node
/**
 * Find + remove duplicate local officials.
 *
 * A "duplicate" = same (state, locality, role, full_name).
 * We keep the oldest row (first inserted) and delete the rest.
 *
 * Run with:
 *   node --env-file=.env.local scripts/dedupe-locals.mjs              # all states
 *   node --env-file=.env.local scripts/dedupe-locals.mjs OK           # one state
 *   node --env-file=.env.local scripts/dedupe-locals.mjs --dry-run    # preview only
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const stateArg = args.find((a) => /^[A-Z]{2}$/i.test(a))?.toUpperCase() ?? null;

let query = supabase
  .from("legislators")
  .select("id, state, locality, role, full_name, created_at")
  .in("level", ["municipal", "county"])
  .order("created_at", { ascending: true })
  .limit(50_000);

if (stateArg) query = query.eq("state", stateArg);

const { data, error } = await query;
if (error) { console.error(error); process.exit(1); }

console.log(`Loaded ${data.length} local officials${stateArg ? ` (${stateArg} only)` : ""}.`);

// Group by composite key — normalize locality + name to handle case
// inconsistencies ("oklahoma city, OK" vs "Oklahoma City, OK").
const groups = new Map();
const norm = (s) => (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
for (const row of data) {
  const key = `${row.state}::${norm(row.locality)}::${row.role}::${norm(row.full_name)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const dupes = [];
for (const rows of groups.values()) {
  if (rows.length < 2) continue;
  // Pick the "best" row to keep: proper-cased locality > all-lowercase,
  // longer title > shorter, then oldest as tiebreaker.
  const ranked = [...rows].sort((a, b) => {
    const aProper = /[A-Z]/.test(a.locality ?? "") ? 1 : 0;
    const bProper = /[A-Z]/.test(b.locality ?? "") ? 1 : 0;
    if (aProper !== bProper) return bProper - aProper;
    return a.created_at.localeCompare(b.created_at);
  });
  const [keep, ...remove] = ranked;
  for (const r of remove) {
    dupes.push({ keep: keep.id, drop: r.id, state: r.state, locality: r.locality, role: r.role, full_name: r.full_name });
  }
}

if (dupes.length === 0) {
  console.log("✓ No duplicates found.");
  process.exit(0);
}

console.log(`\nFound ${dupes.length} duplicate row(s) to remove:\n`);
const byState = {};
for (const d of dupes) {
  byState[d.state] = (byState[d.state] ?? 0) + 1;
}
for (const [s, n] of Object.entries(byState).sort()) {
  console.log(`  ${s}: ${n} dupes`);
}

if (dryRun) {
  console.log("\nDry-run: not deleting. Sample (first 10):");
  for (const d of dupes.slice(0, 10)) {
    console.log(`  - ${d.state} · ${d.locality} · ${d.full_name} (${d.role})`);
  }
  process.exit(0);
}

console.log("\nDeleting duplicates…");
const idsToDelete = dupes.map((d) => d.drop);
// Delete in batches of 100
let deleted = 0;
for (let i = 0; i < idsToDelete.length; i += 100) {
  const batch = idsToDelete.slice(i, i + 100);
  const { error } = await supabase.from("legislators").delete().in("id", batch);
  if (error) {
    console.error("Delete error:", error.message);
    break;
  }
  deleted += batch.length;
}
console.log(`✓ Deleted ${deleted} duplicates.`);

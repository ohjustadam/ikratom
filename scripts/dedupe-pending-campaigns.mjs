#!/usr/bin/env node
/**
 * One-shot dedup pass over pending_review campaigns. Same-state +
 * normalized-title clusters get collapsed: the OLDEST row in each
 * cluster stays as 'pending_review', the rest get
 * review_state='superseded' with superseded_by pointing at the kept row.
 *
 * "Normalized title" = lowercase + non-alnum-space stripped + whitespace
 * collapsed. Catches dup news-article-derived campaigns that came in
 * with slightly different punctuation across syndicated sources.
 *
 * Usage:
 *   node --env-file=.env.local scripts/dedupe-pending-campaigns.mjs --dry-run
 *   node --env-file=.env.local scripts/dedupe-pending-campaigns.mjs
 *
 * Dry-run prints the cluster counts + a sample of what would happen.
 * Live run executes the UPDATE. Idempotent — re-runs are no-ops because
 * each cluster only has one pending_review row left.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const DRY = process.argv.includes("--dry-run");
const PAGE = 1000;

function normalizeTitle(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

console.log(DRY ? "DRY RUN — no writes.\n" : "LIVE RUN — will mark duplicates as superseded.\n");

// Pull every pending_review campaign with the fields we need to dedup.
const { count: total } = await sb
  .from("campaigns")
  .select("id", { count: "exact", head: true })
  .eq("review_state", "pending_review");
console.log(`pending_review total: ${total}`);

const all = [];
for (let off = 0; off < (total ?? 0); off += PAGE) {
  const { data, error } = await sb
    .from("campaigns")
    .select("id, slug, title, state, bill_id, auto_generated, created_at")
    .eq("review_state", "pending_review")
    .order("created_at", { ascending: true })
    .range(off, off + PAGE - 1);
  if (error) throw error;
  all.push(...(data ?? []));
}
console.log(`fetched ${all.length} rows`);

// Build clusters keyed on (state, normalized_title).
const clusters = new Map();
for (const c of all) {
  const key = `${c.state ?? "(none)"}|${normalizeTitle(c.title)}`;
  if (!clusters.has(key)) clusters.set(key, []);
  clusters.get(key).push(c);
}

const multi = [...clusters.entries()].filter(([, members]) => members.length > 1);
const dupTotal = multi.reduce((n, [, members]) => n + members.length - 1, 0);
console.log(`clusters with duplicates: ${multi.length}`);
console.log(`total rows to mark superseded: ${dupTotal}`);

if (multi.length === 0) {
  console.log("Nothing to dedupe.");
  process.exit(0);
}

// Show top-10 biggest clusters for visibility.
multi.sort(([, a], [, b]) => b.length - a.length);
console.log("\nTop 10 biggest clusters:");
multi.slice(0, 10).forEach(([key, members]) => {
  const sample = members[0];
  console.log(`  [${sample.state ?? "--"}] x${members.length} — "${(sample.title ?? "").slice(0, 80)}"`);
});

if (DRY) {
  console.log("\nDRY RUN — exiting without writes.");
  process.exit(0);
}

// Execute: for each cluster, keep members[0] (oldest), mark the rest superseded.
let updated = 0;
for (const [, members] of multi) {
  const keeper = members[0];
  const losers = members.slice(1);
  for (const loser of losers) {
    const { error } = await sb
      .from("campaigns")
      .update({
        review_state: "superseded",
        superseded_by: keeper.id,
        review_reason: `Auto-deduped: collapsed into ${keeper.slug ?? keeper.id} (same state + normalized title).`,
        reviewed_at: new Date().toISOString(),
        active: false,
      })
      .eq("id", loser.id)
      .eq("review_state", "pending_review"); // safety: only flip pending rows
    if (error) {
      console.error(`  failed on ${loser.id}: ${error.message}`);
      continue;
    }
    updated++;
  }
}

console.log(`\nMarked ${updated} duplicate campaigns as superseded.`);
console.log(`Pending queue should now be ${total - updated}.`);

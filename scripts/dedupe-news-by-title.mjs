#!/usr/bin/env node
/**
 * dedupe-news-by-title.mjs — cron-safe duplicate marker.
 *
 * The existing embedding-based dedupe-news.mjs needs Ollama running
 * locally and can't ship as a GH Actions step. But the most common
 * duplicate pattern doesn't need embeddings: Google News RSS surfaces
 * the EXACT same article under multiple per-state queries, producing
 * rows with identical titles.
 *
 * This script handles that exact-title case in seconds — no embeddings,
 * no Ollama dependency. It runs in cron-hourly alongside the news
 * pipeline. For paraphrased near-duplicates (different titles for the
 * same story), dedupe-news.mjs (embedding-based) remains the gold path,
 * run on-demand from the owner's machine where Ollama is available.
 *
 * Strategy:
 *   1. Pull all canonical rows (duplicate_of IS NULL, active=true)
 *      from last 30d.
 *   2. Normalize title (lowercase, collapse whitespace, strip punctuation).
 *   3. Group by normalized title. For each group with >1 member:
 *        - canonical = oldest row (lowest published_at, then created_at)
 *        - mark all other members as duplicate_of = canonical.id
 *
 * The migration-0019 trigger keeps duplicate_count on the canonical
 * in sync automatically.
 *
 * Run:
 *   node --env-file=.env.local scripts/dedupe-news-by-title.mjs
 *   node --env-file=.env.local scripts/dedupe-news-by-title.mjs --dry-run
 *   node --env-file=.env.local scripts/dedupe-news-by-title.mjs --window-days 90
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const winIdx = args.indexOf("--window-days");
const WINDOW_DAYS = winIdx >= 0 ? parseInt(args[winIdx + 1]) : 30;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const t0 = Date.now();
const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

console.log(`Dedupe-news-by-title${DRY ? " [DRY]" : ""} — scanning canonicals from last ${WINDOW_DAYS}d…`);

// Pull canonicals in batches — at 50k news items per year, the 30d
// window should be well under 10k. Pull all in one query.
const { data: rows, error } = await sb
  .from("news_items")
  .select("id, title, state, published_at, scraped_at")
  .eq("active", true)
  .is("duplicate_of", null)
  .gte("scraped_at", since)
  .order("scraped_at", { ascending: true })
  .limit(20_000);

if (error) {
  console.error("query failed:", error.message);
  process.exit(1);
}

console.log(`  ${rows.length} canonical rows in window`);

function normalize(title) {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Build groups
const groups = new Map();
for (const r of rows) {
  const key = normalize(r.title);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

// Find groups with duplicates
const updates = []; // { id, duplicate_of }
let groupsWithDupes = 0;
let totalDupes = 0;
for (const [key, members] of groups) {
  if (members.length < 2) continue;
  groupsWithDupes++;
  // Canonical = oldest by published_at (fall back to created_at)
  members.sort((a, b) => {
    const ap = a.published_at ?? a.scraped_at;
    const bp = b.published_at ?? b.scraped_at;
    return ap.localeCompare(bp);
  });
  const canonical = members[0];
  for (let i = 1; i < members.length; i++) {
    updates.push({ id: members[i].id, duplicate_of: canonical.id });
    totalDupes++;
  }
}

console.log(`  ${groupsWithDupes} group(s) with duplicates · ${totalDupes} rows to mark`);

if (DRY) {
  console.log("\n=== DRY RUN — sample updates (first 10) ===");
  for (const u of updates.slice(0, 10)) console.log(`  ${u.id.slice(0, 8)}…  →  duplicate_of ${u.duplicate_of.slice(0, 8)}…`);
  process.exit(0);
}

// Batch the updates. Supabase doesn't have a single-call multi-update,
// so chunk through individual updates. 200 rows / sec is fine for
// this volume.
let applied = 0;
for (const u of updates) {
  const { error: e } = await sb
    .from("news_items")
    .update({ duplicate_of: u.duplicate_of })
    .eq("id", u.id);
  if (e) {
    console.warn(`  ✗ ${u.id.slice(0, 8)}: ${e.message?.slice(0, 80)}`);
  } else {
    applied++;
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s — ${applied}/${updates.length} marked.`);

try {
  await sb.from("scraper_runs").insert({
    source: "dedupe_news_by_title",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: applied > 0 ? "success" : "empty",
    rows_updated: applied,
    notes: `${groupsWithDupes} dup groups · ${totalDupes} marked · window ${WINDOW_DAYS}d`,
  });
} catch { /* best-effort */ }

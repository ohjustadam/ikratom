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

// Self-healing pass: undo over-aggressive merges where canonical and
// duplicate have DIFFERENT source_names. Earlier title-only grouping
// erased legit multi-source coverage. Idempotent — re-runs after the
// new (title+source) grouping is in place find nothing to undo.
if (!DRY) {
  // Paginate dupes — Supabase caps at 1000 rows per query.
  const allDupes = [];
  let offset = 0;
  while (true) {
    const { data } = await sb
      .from("news_items")
      .select("id, source_name, duplicate_of")
      .not("duplicate_of", "is", null)
      .eq("active", true)
      .range(offset, offset + 999);
    if (!data?.length) break;
    allDupes.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  if (allDupes.length > 0) {
    const canonicalIds = [...new Set(allDupes.map((d) => d.duplicate_of))];
    // Fetch canonicals in chunks — long .in() lists hit URL-length caps.
    const canSrc = new Map();
    for (let i = 0; i < canonicalIds.length; i += 200) {
      const chunk = canonicalIds.slice(i, i + 200);
      const { data } = await sb.from("news_items").select("id, source_name").in("id", chunk);
      for (const c of data ?? []) canSrc.set(c.id, (c.source_name ?? "").toLowerCase().trim());
    }
    const wrong = allDupes
      .filter((d) => {
        const ds = (d.source_name ?? "").toLowerCase().trim();
        const cs = canSrc.get(d.duplicate_of);
        return cs !== undefined && ds !== cs;
      })
      .map((d) => d.id);
    if (wrong.length > 0) {
      for (let i = 0; i < wrong.length; i += 200) {
        const chunk = wrong.slice(i, i + 200);
        await sb.from("news_items").update({ duplicate_of: null }).in("id", chunk);
      }
      console.log(`  un-merged ${wrong.length} rows previously collapsed across different sources`);
    }
  }
}

// Pull canonicals in batches — at 50k news items per year, the 30d
// window should be well under 10k. Pull all in one query.
const { data: rows, error } = await sb
  .from("news_items")
  .select("id, title, source_name, state, published_at, scraped_at")
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

// Build groups keyed by (normalized_title, source_name). Owner reported
// the previous title-only grouping was over-merging: two reporters at
// different outlets covering the same news event commonly write the
// SAME headline (it's how news works), but those are distinct articles
// with distinct angles/quotes/embedded media. Merging only when title
// AND source match catches the Google-News-RSS-syndication case (one
// canonical article re-surfaced under multiple state queries) without
// erasing genuine multi-source coverage.
const groups = new Map();
for (const r of rows) {
  const titleKey = normalize(r.title);
  if (!titleKey) continue;
  const sourceKey = (r.source_name ?? "").toLowerCase().trim();
  const key = `${titleKey}::${sourceKey}`;
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

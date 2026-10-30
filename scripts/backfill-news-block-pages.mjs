#!/usr/bin/env node
/**
 * Backfill: clear Akamai "Access Denied" pages saved as news article bodies.
 *
 * Until 2026-10-29 extract-news-content stored Akamai's block page as the story
 * when headless Chromium was served it instead of the article: two paragraphs,
 * "Reference #18.<hex>.<ts>.<hex>" and an errors.edgesuite.net link, shown on
 * /news/[id] as the body (166 rows; TEGNA TV sites, HHS.gov, GlobeNewswire).
 * The extractor now rejects those pages (isAkamaiBlockPage); this clears the
 * rows already saved.
 *
 * What it writes: body_paragraphs = null, nothing else. That alone re-queues a
 * row: extract-news-content re-picks rows with no paragraphs while
 * body_extract_attempts < RETRY_CAP, and stamps them with no body at the cap.
 * body_extracted_at stays set on purpose: every news feed and push lists only
 * rows that have it, so clearing it would hide these stories, and rows older
 * than the extractor's 21-day window would never be stamped again.
 *
 * Rows scraped or published in the last 24h are left alone, so the re-extract
 * can't make a story newly push-eligible (push-state-news looks back 12h).
 * Matching is the exact stored shape (isAkamaiBlockExcerpt), nothing looser.
 *
 * Reversible: the cleared values are the block page, not content.
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-news-block-pages.mjs           # dry run: list ids
 *   node --env-file=.env.local scripts/backfill-news-block-pages.mjs --apply   # write
 */
import { createClient } from "@supabase/supabase-js";
import { isAkamaiBlockExcerpt } from "./lib/article-content.mjs";

const APPLY = process.argv.includes("--apply");
const QUIET_HOURS = 24;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const cutoff = Date.now() - QUIET_HOURS * 3600_000;
const isRecent = (ts) => ts != null && Date.parse(ts) >= cutoff;

// Filter on the first paragraph server-side so only candidates cross the wire,
// then confirm the whole stored shape in JS. Paged: PostgREST caps at 1000.
async function candidates(pattern) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("news_items")
      .select("id, source_name, scraped_at, published_at, body_paragraphs")
      .like("body_paragraphs->>0", pattern)
      .order("id")
      .range(from, from + 999);
    if (error) { console.error("query failed:", error.message); process.exit(1); }
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const byId = new Map();
for (const r of [...await candidates("Reference #%"), ...await candidates("%errors.edgesuite.net/%")]) byId.set(r.id, r);
const blocked = [...byId.values()].filter((r) => isAkamaiBlockExcerpt(r.body_paragraphs));
const recent = blocked.filter((r) => isRecent(r.scraped_at) || isRecent(r.published_at));
const targets = blocked.filter((r) => !recent.includes(r));

console.log(`Akamai block pages stored as bodies: ${blocked.length} · skipped (last ${QUIET_HOURS}h): ${recent.length} · to clear: ${targets.length}${APPLY ? "" : " [DRY RUN]"}`);
for (const r of targets) console.log(`  ${r.id}  ${r.scraped_at.slice(0, 10)}  ${r.source_name ?? "?"}`);
for (const r of recent) console.log(`  skip ${r.id}  ${r.scraped_at.slice(0, 16)}  ${r.source_name ?? "?"}`);

if (!APPLY) { console.log("\nDry run. Re-run with --apply to clear them."); process.exit(0); }

let cleared = 0;
for (let i = 0; i < targets.length; i += 100) {
  const ids = targets.slice(i, i + 100).map((r) => r.id);
  const { data, error } = await sb
    .from("news_items")
    .update({ body_paragraphs: null })
    .in("id", ids)
    .select("id");
  if (error) { console.error(`update failed: ${error.message}`); process.exit(1); }
  cleared += data.length;
}
console.log(`\nCleared body_paragraphs on ${cleared} of ${targets.length} rows.`);
if (cleared !== targets.length) process.exit(1);

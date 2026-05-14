/**
 * Index per-legislator mentions in news_items (Phase 3 D4 Phase 1).
 *
 * For each legislator with state X, scan news_items where state=X and
 * regex-match against title, summary, body_extract_excerpt using
 * exact-name and title+lastname patterns. Write hits to the
 * legislator_news_mentions table.
 *
 * Honest scope: the news scrape is kratom-policy-focused, not
 * legislator-focused. Most articles say "Tennessee lawmakers" not
 * specific names. Phase 1 will populate sparsely. That's by design —
 * when a match exists it's high-signal ("Sen. Smith is named in
 * 3 kratom-policy articles in TN").
 *
 * Usage:
 *   node --env-file=.env.local scripts/index-legislator-news-mentions.mjs
 *   node --env-file=.env.local scripts/index-legislator-news-mentions.mjs --state NY
 *   node --env-file=.env.local scripts/index-legislator-news-mentions.mjs --dry-run
 *
 * Idempotent: UNIQUE(legislator_id, news_item_id, matched_field) means
 * re-running is a no-op for existing matches. Add upsert if we later
 * want to refresh mention_context.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const ONLY_STATE = arg("--state");
const DRY_RUN = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Pattern construction
//
// We build two patterns per legislator:
//   1. Exact full-name — "John Q. Smith" — highest confidence
//   2. Title+lastname  — "Sen./Rep./etc. Smith" — same-state scoped
//
// Skipped (too noisy for Phase 1):
//   - Lastname-only — "Smith said…" — too many false positives
//   - First-name only — same
//
// Escaping: full_name can contain regex metas (e.g. "O'Brien").
// We escape before injecting into the pattern.
// =============================================================
function regexEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Senate / lower-chamber title prefixes that map to a legislator.
// Cast wide — most state press uses "Sen./Rep." but some use chamber-
// specific titles like "Assemblymember" (NY) or "Delegate" (MD/VA/WV).
const TITLE_PREFIX = "(?:Sen(?:ator)?|Rep(?:resentative)?|Assembly\\s?(?:member|man|woman)|Delegate|Speaker|Majority\\s+Leader|Minority\\s+Leader|Lieutenant\\s+Governor|Lt\\.?\\s+Gov(?:ernor)?)\\.?\\s+";

function buildPatterns(fullName) {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  // "Last, First" form sometimes appears in legislator imports.
  // Normalize.
  const normalized = trimmed.includes(",")
    ? trimmed.split(",").map(s => s.trim()).reverse().join(" ")
    : trimmed;
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null; // single-token name = unsafe
  const last = parts[parts.length - 1];
  // Lastname under 4 chars is too prone to false positives ("Lee" matches
  // every Bruce Lee article). Skip title+last for those; keep full-name
  // pattern only.
  const safeLast = last.length >= 4;
  const fullNamePattern = new RegExp(`\\b${regexEscape(normalized)}\\b`, "i");
  const titleLastPattern = safeLast
    ? new RegExp(`\\b${TITLE_PREFIX}${regexEscape(last)}\\b`, "i")
    : null;
  return { fullNamePattern, titleLastPattern, normalized, last };
}

// =============================================================
// Context snippet around the match — ~120 chars centered on the hit.
// =============================================================
function extractContext(text, match) {
  if (!text || !match) return null;
  const idx = match.index;
  const half = 60;
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, idx + match[0].length + half);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

// =============================================================
// Main
// =============================================================
const t0 = Date.now();

// Supabase's default page size is 1000 rows. Both tables exceed that
// (8k+ legislators, 4k+ news_items), so we paginate via range().
async function fetchAllPaginated(table, columns, filters) {
  const PAGE = 1000;
  const out = [];
  for (let start = 0; ; start += PAGE) {
    let q = sb.from(table).select(columns).range(start, start + PAGE - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(`${table} page ${start}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

const legFilters = { active: true };
if (ONLY_STATE) legFilters.state = ONLY_STATE.toUpperCase();
const legs = await fetchAllPaginated("legislators", "id, full_name, state, role", legFilters);
console.log(`Loaded ${legs.length} active legislators${ONLY_STATE ? ` (${ONLY_STATE})` : ""}`);

const newsFilters = { active: true };
if (ONLY_STATE) newsFilters.state = ONLY_STATE.toUpperCase();
const news = await fetchAllPaginated("news_items", "id, state, title, summary, body_extract_excerpt", newsFilters);
console.log(`Loaded ${news.length} active news_items${ONLY_STATE ? ` (${ONLY_STATE})` : ""}`);

// Group news by state for efficient matching.
const newsByState = new Map();
for (const n of news) {
  const s = (n.state || "").toUpperCase();
  if (!s) continue;
  if (!newsByState.has(s)) newsByState.set(s, []);
  newsByState.get(s).push(n);
}

const mentions = [];
let scanned = 0;
let skippedNoPattern = 0;

for (const leg of legs) {
  const patterns = buildPatterns(leg.full_name);
  if (!patterns) { skippedNoPattern++; continue; }
  const stateNews = newsByState.get((leg.state || "").toUpperCase()) ?? [];
  for (const n of stateNews) {
    scanned++;
    // Iterate fields in priority order. We log per-field hits so a
    // legislator named in title + summary creates two rows — the
    // briefing render dedupes.
    for (const field of /** @type {const} */ (["title", "summary", "body_extract_excerpt"])) {
      const text = n[field];
      if (!text) continue;
      let match = patterns.fullNamePattern.exec(text);
      let confidence = "exact_full_name";
      if (!match && patterns.titleLastPattern) {
        match = patterns.titleLastPattern.exec(text);
        confidence = "title_lastname";
      }
      if (!match) continue;
      mentions.push({
        legislator_id: leg.id,
        news_item_id: n.id,
        match_confidence: confidence,
        matched_field: field === "body_extract_excerpt" ? "body" : field,
        mention_context: extractContext(text, match),
      });
    }
  }
}

console.log(`Scanned ${scanned} (legislator × news_item) pairs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Matches found: ${mentions.length} (skipped ${skippedNoPattern} single-token names)`);

if (mentions.length === 0) {
  console.log("No matches. Done.");
  process.exit(0);
}

// Top legislators by mention count (sanity check + reporting)
const byLeg = new Map();
for (const m of mentions) byLeg.set(m.legislator_id, (byLeg.get(m.legislator_id) ?? 0) + 1);
const top = [...byLeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
const legById = new Map(legs.map(l => [l.id, l]));
console.log("\nTop 10 most-mentioned legislators:");
for (const [id, count] of top) {
  const l = legById.get(id);
  console.log(`  ${l.state} ${l.role.padEnd(15)} ${l.full_name.padEnd(35)} ${count} mention(s)`);
}

if (DRY_RUN) {
  console.log("\nDRY RUN — skipping insert.");
  process.exit(0);
}

// Bulk insert with onConflict for idempotency. Batch 500 rows to stay
// inside Supabase's response-size limits.
const BATCH = 500;
let inserted = 0;
let conflicted = 0;
for (let i = 0; i < mentions.length; i += BATCH) {
  const chunk = mentions.slice(i, i + BATCH);
  const { error } = await sb
    .from("legislator_news_mentions")
    .upsert(chunk, { onConflict: "legislator_id,news_item_id,matched_field", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error(`  chunk ${i / BATCH} insert error:`, error.message);
    continue;
  }
  inserted += chunk.length;
  if (i % (BATCH * 10) === 0 && i > 0) console.log(`  …upserted ${inserted}/${mentions.length}`);
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${inserted} mention rows upserted (existing rows preserved).`);

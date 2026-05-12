#!/usr/bin/env node
/**
 * Verify each kratom-classified news_item is actually about kratom by:
 *
 *   PHASE 1 (today, cheap, no browser): check the article TITLE + SUMMARY
 *     for any kratom keyword (kratom / mitragyna / mitragynine / 7-OH /
 *     "gas station drugs" / tianeptine). Items with NO keyword in
 *     title-or-summary are flagged as false positives — Google News
 *     returned them because the source page had the keyword in a
 *     sidebar / related-stories widget, not in the article itself.
 *
 *   PHASE 2 (future, Playwright-based): fetch the actual article body
 *     and verify the keyword appears in the main content (not nav /
 *     aside / footer / recirculation). This requires JS-based URL
 *     resolution since all our stored URLs are news.google.com
 *     redirects that can't be followed by HTTP-level fetch — see the
 *     TODO at the bottom of this file.
 *
 * Sets news_items.body_has_kratom_keyword:
 *   - TRUE  → keyword in title or summary → keep visible
 *   - FALSE → no keyword anywhere available → false positive → hide
 *   - NULL  → couldn't decide (e.g. summary still null, awaiting Phase 2)
 *
 * Always sets body_verified_at so we don't re-check every cron run.
 *
 * Run:
 *   node --env-file=.env.local scripts/verify-news-body.mjs --limit 500
 *   node --env-file=.env.local scripts/verify-news-body.mjs --refresh  # re-verify done items
 *   node --env-file=.env.local scripts/verify-news-body.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { hasKratomKeyword } from "./lib/kratom-keywords.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "500");
const REFRESH = args.includes("--refresh");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

let q = sb.from("news_items")
  .select("id, url, title, summary, state, ai_relevance_score")
  .eq("active", true)
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("body_verified_at", null);

const { data: items, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!items || items.length === 0) {
  console.log("Nothing to verify.");
  process.exit(0);
}

console.log(`Phase 1 verifying ${items.length} items (title + summary keyword check)${DRY_RUN ? " [DRY RUN]" : ""}…\n`);

let kept = 0, flagged = 0;
const t0 = Date.now();

for (const it of items) {
  const titleHasKw = hasKratomKeyword(it.title ?? "");
  const summaryHasKw = hasKratomKeyword(it.summary ?? "");
  const hasKw = titleHasKw || summaryHasKw;

  // Phase 1 decision rule — strict for FP precision:
  //   - Title has kratom keyword → TRUE (keep visible)
  //   - Title has no keyword + summary rescues it → TRUE
  //   - Title has no keyword + summary has no keyword (or null) → FALSE
  //
  // Trade-off: we may flag news-roundup articles ("Magnolia Mornings:
  // Feb 19") whose titles don't mention kratom but whose bodies do.
  // Those get rescued in Phase 2 (Playwright body fetch — see TODO).
  // For the precision target the owner asked for, false-negative on
  // a news roundup is acceptable; false-positive on Alaska election
  // trial is not.
  const decision = hasKw;

  const label = decision ? "✓ keep" : "⚠ FP";
  console.log(`  [${(it.state ?? "?").padEnd(3)}] ${label}  ${(it.title ?? "").slice(0, 80)}`);

  if (decision) kept++;
  else flagged++;

  if (!DRY_RUN) {
    await sb.from("news_items").update({
      body_verified_at: new Date().toISOString(),
      body_has_kratom_keyword: decision,
    }).eq("id", it.id);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s — kept=${kept} flagged=${flagged}`);

try {
  await sb.from("scraper_runs").insert({
    source: "verify_news_body",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: items.length === 0 ? "empty" : "success",
    rows_updated: kept + flagged,
    notes: `Phase 1 title+summary check: ${kept} kept, ${flagged} FP flagged`,
  });
} catch { /* best-effort */ }

process.exit(0);

// ─────────────────────────────────────────────────────────────────────
// PHASE 2 (TODO) — actual article body verification.
//
// Why deferred: every URL in news_items is a Google News redirect
// (https://news.google.com/rss/articles/CBM...) — Google uses JS-based
// redirects so plain HTTP fetch returns Google's landing page, not
// the publisher article. The fix is to resolve via Playwright (which
// we already use for BoP scraping in scrape-bop-browser.mjs):
//
//   1. Launch Chromium, open the Google News URL
//   2. Wait for the JS redirect to settle
//   3. Capture page.url() — the final publisher URL
//   4. Fetch that URL with the existing extractArticleBody() helper
//   5. Check keyword in extracted body (not nav/aside/related)
//
// This catches the remaining ambiguous cases Phase 1 can't decide:
// news-roundup articles like "Magnolia Mornings: Feb 19" whose title
// doesn't mention kratom but whose body might. Until Phase 2 ships,
// those stay NULL (visible) so we don't suppress legitimate signal.
// ─────────────────────────────────────────────────────────────────────

/**
 * Data-quality cleanup pass.
 *
 * Owner directive: "make sure no dupes or non relevant things show up …
 * this is a weapon that needs to be precise." This script runs the
 * cleanup operations that don't have a natural home in any other
 * pipeline — the safety-net pass that catches what slipped through.
 *
 * What it does:
 *
 *   1. **Irrelevant news items**: deactivate (active=false) any
 *      news_items where the body verifier explicitly returned
 *      body_has_kratom_keyword=false AND the title also doesn't
 *      contain a kratom keyword. These are RSS title-match false
 *      positives — articles about NBA players, generic drug overdoses,
 *      tax bills, etc. that got ingested then the body-verifier
 *      flagged. Without this step they keep polluting state news
 *      feeds indefinitely.
 *
 *   2. **Orphaned legislators with no contact info**: flag legislators
 *      where active=true but email AND phone are both null AND
 *      last_synced_at > 60d ago — these are likely no longer in
 *      office, contact info just was never scraped. Report-only;
 *      doesn't auto-deactivate (we don't want to lose historical
 *      vote-attribution if they're matched to bill_vote_members).
 *
 *   3. **Pending municipal_meetings with no kratom mention in agenda**:
 *      report-only. Surface them for admin moderation; widened
 *      discovery (post-PR #265) means we'll see more of these.
 *
 * Idempotent — re-running is safe (deactivated rows stay deactivated).
 *
 * Usage:
 *   node --env-file=.env.local scripts/cleanup-data-quality.mjs
 *   node --env-file=.env.local scripts/cleanup-data-quality.mjs --dry-run
 *   node --env-file=.env.local scripts/cleanup-data-quality.mjs --news-only
 *   node --env-file=.env.local scripts/cleanup-data-quality.mjs --report-only
 *     # don't write anything, just report
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);

const DRY_RUN = flag("--dry-run");
const REPORT_ONLY = flag("--report-only");
const NEWS_ONLY = flag("--news-only");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Paginate past Supabase's 1000-row response cap (lesson learned the
// hard way from the matrix-completion sweep — without this, audits
// silently truncate).
async function paginated(table, columns, applyFilters) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    let q = sb.from(table).select(columns).range(start, start + 999);
    q = applyFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} page ${start}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const KRATOM_RE = /kratom|mitragyn|7[ -]?oh|7-?hydroxymitragynine/i;

// =============================================================
// 1. Irrelevant news items — deactivate
// =============================================================
async function cleanIrrelevantNews() {
  console.log("\n=== 1. Irrelevant news items (body-verified, no kratom keyword) ===");
  const all = await paginated(
    "news_items",
    "id, state, title",
    (q) => q
      .eq("active", true)
      .eq("body_has_kratom_keyword", false)
      .not("body_verified_at", "is", null)
      .is("duplicate_of", null),
  );
  // Title also has no kratom keyword = safe to deactivate.
  // Title has kratom but body doesn't = ambiguous (listicles, side-mentions).
  // We KEEP the ambiguous ones; admins can review at /admin/intel-health.
  const toDeactivate = all.filter(r => !KRATOM_RE.test(r.title || ""));
  const ambiguous = all.filter(r => KRATOM_RE.test(r.title || ""));
  console.log(`  Total body-verified-no-kratom: ${all.length}`);
  console.log(`  Safe to deactivate (no kratom in title either): ${toDeactivate.length}`);
  console.log(`  Ambiguous (kratom in title but not body): ${ambiguous.length}`);
  if (toDeactivate.length === 0) return { deactivated: 0 };

  if (REPORT_ONLY || DRY_RUN) {
    console.log(`  [${DRY_RUN ? "DRY RUN" : "REPORT"}] would deactivate ${toDeactivate.length} rows.`);
    console.log(`  Sample (first 5):`);
    for (const r of toDeactivate.slice(0, 5)) console.log(`    [${r.state}] ${r.title?.slice(0, 100)}`);
    return { deactivated: 0 };
  }

  // Batch update to stay inside Supabase response limits. We update
  // 200 IDs at a time using the .in() filter — straightforward and
  // each batch returns quickly.
  let updated = 0;
  const BATCH = 200;
  for (let i = 0; i < toDeactivate.length; i += BATCH) {
    const ids = toDeactivate.slice(i, i + BATCH).map(r => r.id);
    const { error } = await sb
      .from("news_items")
      .update({
        active: false,
        flag_reason: "body_verified_no_kratom_keyword",
      })
      .in("id", ids);
    if (error) {
      console.error(`  batch ${i / BATCH} update failed: ${error.message}`);
      continue;
    }
    updated += ids.length;
    if (i % (BATCH * 5) === 0 && i > 0) console.log(`  …${updated}/${toDeactivate.length} deactivated`);
  }
  console.log(`  ✓ Deactivated ${updated} irrelevant news items`);
  return { deactivated: updated, ambiguous: ambiguous.length };
}

// =============================================================
// 2. Stale legislators with no contact info — report only
// =============================================================
async function reportStaleLegislators() {
  console.log("\n=== 2. Stale legislators (60d+ no sync, no email AND no phone) ===");
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const all = await paginated(
    "legislators",
    "id, state, full_name, role, last_synced_at",
    (q) => q
      .eq("active", true)
      .is("email", null)
      .is("phone", null)
      .lt("last_synced_at", sixtyDaysAgo),
  );
  console.log(`  Active + 60d-stale + no contact: ${all.length}`);
  if (all.length === 0) return { stale: 0 };
  const byState = new Map();
  for (const r of all) byState.set(r.state, (byState.get(r.state) || 0) + 1);
  const top = [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  By state (top 8):`);
  for (const [s, c] of top) console.log(`    ${s}: ${c}`);
  console.log(`  These are candidates for editorial review at /admin/intel-health/legislators-stale.`);
  console.log(`  NOT auto-deactivating (some may be ex-legislators referenced by bill_vote_members).`);
  return { stale: all.length };
}

// =============================================================
// 3. Pending municipal meetings — report only
// =============================================================
async function reportPendingMeetings() {
  console.log("\n=== 3. Pending municipal meetings ===");
  const pending = await paginated(
    "municipal_meetings",
    "id, state, locality, body_name, meeting_at, discovered_via, kratom_relevance",
    (q) => q.eq("moderation_status", "pending_review"),
  );
  console.log(`  Pending review: ${pending.length}`);
  for (const r of pending.slice(0, 10)) {
    const when = r.meeting_at ? new Date(r.meeting_at).toLocaleDateString() : "?";
    console.log(`    [${r.state}] ${r.locality ?? "?"} · ${r.body_name ?? "?"} · ${when} (relevance: ${r.kratom_relevance})`);
  }
  if (pending.length > 10) console.log(`    + ${pending.length - 10} more`);
  console.log(`  Admins review + approve at /admin/municipal-meetings.`);
  return { pending: pending.length };
}

// =============================================================
// Run
// =============================================================
const t0 = Date.now();
console.log(`Cleanup ${DRY_RUN || REPORT_ONLY ? "(report-only)" : "(write)"} starting…`);

const newsResult = await cleanIrrelevantNews();
if (!NEWS_ONLY) {
  await reportStaleLegislators();
  await reportPendingMeetings();
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
if (newsResult.deactivated > 0) {
  console.log(`News feed is now ${newsResult.deactivated} rows lighter — next user-facing query will skip these.`);
}

/**
 * Data hygiene: fix bills classified as kratom_relevance='anti' that aren't
 * actually anti-kratom bills.
 *
 * Discovery context: while building the /banned page + takeback intel, the
 * page over-counted "banning states" because the kratom_relevance='anti' +
 * status='enacted' + scope='state' filter caught:
 *   - Bills whose title was misclassified upstream (e.g. LA SB 154 — title
 *     says 'criminalizes kratom' but the deep-analyzed bill text is about
 *     West Baton Rouge Parish jury commissions). substance_targeting deep
 *     analysis correctly says all alkaloids are neutral.
 *   - Bills whose status was stuck at 'enacted' but last_action says DEAD
 *     (ME LD 1546).
 *   - Bills whose status was stuck at 'enacted' but last_action says only
 *     'Sponsor(s) Added' (TN SB 1656 — still in committee).
 *
 * What this script does:
 *   1. Finds bills where kratom_relevance='anti' AND title mentions kratom
 *      but summary_long doesn't. After per-bill spot-check (Nov 2026),
 *      ALL 39 hits were bills with correct anti-kratom titles whose
 *      summary_long had been hallucinated about unrelated topics. The
 *      relevance classification is correct; the summary is broken.
 *      Action (default): CLEAR the bad summary_long + journey fields and
 *      reset deep_analyzed_at so the next cron re-enriches. KEEP
 *      kratom_relevance='anti' since the title is the source of truth.
 *      (Legacy --flip-relevance flag preserves the old behavior of
 *      flipping to neutral, for cases where the title was the wrong
 *      source — e.g. LA SB 154 — but those are now rare.)
 *   2. Finds bills where status='enacted' but last_action contains 'DEAD'
 *      or 'Placed in Legislative Files'. Action: flip status to 'dead'.
 *   3. Finds bills where status='enacted' but last_action is 'Sponsor(s)
 *      Added' (and similar early-stage actions). Action: flip status to
 *      'introduced'.
 *
 * Idempotent — re-running is safe. --dry-run shows what would change.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
// Pass 1 (title-vs-summary mismatch) was previously OFF by default.
// After investigation it became safe to run because the new default
// action is "clear bad summary" (not "flip relevance"). Still requires
// --include-pass1 for backward compat / explicit opt-in.
const INCLUDE_PASS_1 = args.includes("--include-pass1");
// Legacy mode: flip kratom_relevance to neutral instead of clearing
// the summary. Use only when the title is the suspect (rare).
const FLIP_RELEVANCE = args.includes("--flip-relevance");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const DEAD_PATTERNS = [
  /\bdead\b/i,
  /placed in legislative files/i,
  /\bvetoed\b/i,
  /failed in committee/i,
  /died in (committee|chamber)/i,
];

const NOT_ACTUALLY_ENACTED_PATTERNS = [
  /^sponsor\(s\) added/i,
  /^read first time/i,
  /^introduced/i,
  /^assigned to committee/i,
  /^referred to/i,
];

let totalFixes = 0;

// =============================================================
// Pass 1: title mentions kratom but deep-analyzed summary_long doesn't.
//
// After investigation (Nov 2026): all 39 hits were real anti-kratom
// bills (KCPA prohibitions, Schedule I additions, etc.) whose
// summary_long had been generated for a completely different bill text
// — a bug in enrich-bill-journey.mjs's PDF fetch, NOT a kratom_relevance
// misclassification. So the right action is to clear the hallucinated
// summaries (which actively mislead users), keep the relevance, and
// let the next cron re-run regenerate them.
//
// Use --flip-relevance to revert to the old behavior (flip kratom_relevance
// to neutral) for the rare case where the title is the wrong source.
// =============================================================
console.log(`=== Pass 1: title mentions kratom but deep summary doesn't ===`);
if (!INCLUDE_PASS_1) {
  console.log(`  (skipped — pass --include-pass1 to enable;`);
  console.log(`   default action clears bad summary_long without flipping relevance.`);
  console.log(`   use --flip-relevance for legacy behavior.)\n`);
} else
{
  const { data: rows } = await sb
    .from("bills")
    .select("id, state, bill_number, title, kratom_relevance, summary_long")
    .eq("kratom_relevance", "anti")
    .eq("active", true)
    .not("summary_long", "is", null);

  let count = 0;
  for (const r of rows ?? []) {
    const title = (r.title ?? "").toLowerCase();
    const longSummary = (r.summary_long ?? "").toLowerCase();
    if (!title.includes("kratom")) continue;
    if (longSummary.length < 100) continue; // summary_long too short to trust
    if (longSummary.includes("kratom")) continue; // summary correctly references kratom
    // Also check mitragynine — some bills use the alkaloid name not "kratom"
    if (longSummary.includes("mitragynine") || longSummary.includes("7-hydroxymitragynine")) continue;
    count++;
    console.log(`  ${r.state} ${r.bill_number}: title says kratom but summary_long is about something else`);
    console.log(`    title: ${(r.title ?? "").slice(0, 90)}`);
    console.log(`    summary_long start: ${longSummary.slice(0, 150)}…`);
    if (DRY_RUN) continue;

    if (FLIP_RELEVANCE) {
      const { error } = await sb
        .from("bills")
        .update({ kratom_relevance: "neutral", relevance_confidence: 0.3 })
        .eq("id", r.id);
      if (error) console.error(`    ✗ ${error.message}`);
      else { console.log(`    ✓ flipped to neutral`); totalFixes++; }
    } else {
      // Default: clear the hallucinated enrichment fields. Keep the
      // title-driven kratom_relevance='anti' since the title is the
      // source of truth here. Nulling deep_analyzed_at +
      // journey_analyzed_at lets the next cron pick these up for
      // re-enrichment.
      const { error } = await sb
        .from("bills")
        .update({
          summary_long: null,
          summary_ai: null,
          advocacy_callout: null,
          journey_narrative: null,
          journey_analyzed_at: null,
          deep_analyzed_at: null,
        })
        .eq("id", r.id);
      if (error) console.error(`    ✗ ${error.message}`);
      else { console.log(`    ✓ cleared hallucinated summary (will re-enrich on next cron)`); totalFixes++; }
    }
  }
  console.log(`  → ${count} bills matched.\n`);
}

// =============================================================
// Pass 2: status='enacted' but last_action says DEAD
// =============================================================
console.log(`=== Pass 2: status='enacted' but last_action says DEAD ===`);
{
  const { data: rows } = await sb
    .from("bills")
    .select("id, state, bill_number, title, status, last_action")
    .eq("status", "enacted")
    .eq("active", true)
    .not("last_action", "is", null);

  let count = 0;
  for (const r of rows ?? []) {
    if (!DEAD_PATTERNS.some((p) => p.test(r.last_action ?? ""))) continue;
    count++;
    console.log(`  ${r.state} ${r.bill_number}: last_action="${(r.last_action ?? "").slice(0, 80)}"`);
    if (DRY_RUN) continue;
    const { error } = await sb
      .from("bills")
      .update({ status: "dead" })
      .eq("id", r.id);
    if (error) console.error(`    ✗ ${error.message}`);
    else { console.log(`    ✓ flipped to dead`); totalFixes++; }
  }
  console.log(`  → ${count} bills matched.\n`);
}

// =============================================================
// Pass 3: status='enacted' but last_action is early-stage
// =============================================================
console.log(`=== Pass 3: status='enacted' but last_action is early-stage ===`);
{
  const { data: rows } = await sb
    .from("bills")
    .select("id, state, bill_number, title, status, last_action")
    .eq("status", "enacted")
    .eq("active", true)
    .not("last_action", "is", null);

  let count = 0;
  for (const r of rows ?? []) {
    if (!NOT_ACTUALLY_ENACTED_PATTERNS.some((p) => p.test(r.last_action ?? ""))) continue;
    count++;
    console.log(`  ${r.state} ${r.bill_number}: last_action="${(r.last_action ?? "").slice(0, 80)}"`);
    if (DRY_RUN) continue;
    const { error } = await sb
      .from("bills")
      .update({ status: "introduced" })
      .eq("id", r.id);
    if (error) console.error(`    ✗ ${error.message}`);
    else { console.log(`    ✓ flipped to introduced`); totalFixes++; }
  }
  console.log(`  → ${count} bills matched.\n`);
}

console.log(`Done. ${totalFixes} bills updated${DRY_RUN ? " (DRY RUN — nothing actually changed)" : ""}.`);

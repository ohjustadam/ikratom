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
 *   1. Finds bills where kratom_relevance='anti' AND scope='state' AND
 *      status='enacted' AND substance_targeting was deep-analyzed AND
 *      ALL five substance stances are 'neutral'. These are bills where
 *      the deep analysis disagrees with the lighter classification.
 *      Action: flip kratom_relevance to 'neutral'.
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
// Pass 1 (title-vs-summary mismatch) is OFF by default because it surfaced 39
// bills, signaling a systemic upstream data-quality issue with summary_long
// generation rather than per-bill misclassification. Run with --include-pass1
// only after the root cause is investigated.
const INCLUDE_PASS_1 = args.includes("--include-pass1");

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
// Most reliable misclassification signal — when the deep analysis of the
// actual bill text contains no kratom mention, the upstream title/relevance
// classification is almost certainly wrong (OpenStates data quality issue).
// LA SB 154 is the prototype: title says 'criminalizes kratom' but the
// actual bill is about West Baton Rouge Parish jury commissions.
// =============================================================
console.log(`=== Pass 1: title mentions kratom but deep summary doesn't ===`);
if (!INCLUDE_PASS_1) {
  console.log(`  (skipped — pass --include-pass1 to enable; 39 bills matched on prior run`);
  console.log(`   suggesting systemic summary_long-vs-title mismatch upstream, not per-bill error)\n`);
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
    const { error } = await sb
      .from("bills")
      .update({ kratom_relevance: "neutral", relevance_confidence: 0.3 })
      .eq("id", r.id);
    if (error) console.error(`    ✗ ${error.message}`);
    else { console.log(`    ✓ flipped to neutral`); totalFixes++; }
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

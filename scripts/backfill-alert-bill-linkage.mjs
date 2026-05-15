/**
 * Backfill: link approved policy_alerts to bills via bill-number regex
 * on the alert title.
 *
 * Owner directive 2026-05-14: 'we have so much information that has
 * context to correlate to each other. we need to find smart ways to do
 * this. it should be the same and uniform for all states.'
 *
 * Why this exists: the /bills/[id] news-coverage section pulls news via
 * the chain news_items → policy_alerts.bill_id. But 1,167 of 1,200
 * approved alerts have bill_id=NULL — meaning a bunch of news_items that
 * were correctly classified as kratom-policy events never connect back
 * to the bill they're about. This script closes that gap.
 *
 * Approach:
 *   1. Pull every alert with moderation_status='approved' and bill_id IS NULL
 *   2. Run a bill-number regex on title (covers state, county, federal
 *      patterns); if it matches AND state matches the alert's locality,
 *      look up bills by (state, bill_number)
 *   3. If exactly one match → update alert.bill_id; if multiple, leave
 *      for admin
 *
 * Idempotent — alerts that already have bill_id are skipped. Safe to
 * re-run as new alerts land.
 *
 * Run:
 *   node --env-file=.env.local scripts/backfill-alert-bill-linkage.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-alert-bill-linkage.mjs
 *   node --env-file=.env.local scripts/backfill-alert-bill-linkage.mjs --limit 100
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const LIMIT = parseInt(arg("--limit") ?? "2000", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// Bill-number regex patterns. Conservative — matches only forms we
// actually see in state legislative data. Federal patterns deliberately
// excluded (HR 7 false-positive with phrases like "Section HR 7").
const BILL_PATTERNS = [
  // State assembly / house: "AB 1234", "HB 5126", "HF 4223" etc.
  // Two-letter chamber prefix + optional period + spaces + digits.
  /\b(AB|HB|SB|HF|SF|HJR|SJR|HCR|SCR|HR|SR|LB|LD|H|S|A)\s*\.?\s*(\d{1,4})\b/g,
  // County / city ordinance: "I.R. 1234-2026", "Resolution 1279-2026"
  /\b(I\.R\.|Resolution(?:\s+No\.?)?|Ordinance(?:\s+No\.?)?)\s*(\d{1,5}-\d{2,4})\b/gi,
];

function extractBillNumbers(text) {
  const hits = new Set();
  for (const re of BILL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const chamber = m[1].replace(/\s+/g, "").toUpperCase();
      const num = m[2];
      // Normalize to "AB 1234" style (chamber + space + number)
      hits.add(`${chamber} ${num}`);
    }
  }
  return [...hits];
}

console.log(`Backfill alert→bill linkage${DRY ? " (DRY RUN)" : ""}…`);

const { data: alerts } = await sb
  .from("policy_alerts")
  .select("id, title, locality, kind, created_at")
  .eq("moderation_status", "approved")
  .is("bill_id", null)
  .order("created_at", { ascending: false })
  .limit(LIMIT);

console.log(`Found ${alerts?.length ?? 0} alerts without bill_id\n`);

let linked = 0, noMatch = 0, multiMatch = 0, noPattern = 0, skipped = 0;
const stats = new Map(); // by state for visibility

for (const a of alerts ?? []) {
  // Skip if locality isn't a 2-letter state code — we can't scope the
  // bill lookup safely otherwise (LOCAL ordinances are handled via
  // extract-bills-from-alerts.mjs which already does the heavy lifting).
  if (!a.locality || !/^[A-Z]{2}$/.test(a.locality)) {
    skipped++;
    continue;
  }
  const candidates = extractBillNumbers(a.title ?? "");
  if (candidates.length === 0) {
    noPattern++;
    continue;
  }
  // Look up each candidate against bills in this state. Many alerts
  // mention multiple bill numbers (e.g. "TN SB 1656 / HB 1649"). Try
  // every candidate; if exactly one matches a bill in DB, use it.
  let matches = [];
  for (const candidate of candidates) {
    const { data: bills } = await sb
      .from("bills")
      .select("id, state, bill_number, active, last_action_at")
      .eq("state", a.locality)
      .eq("bill_number", candidate)
      .eq("active", true);
    if (bills && bills.length > 0) {
      matches.push(...bills);
    }
    // Also try variants — sometimes our DB has "SB 1656" but title says
    // "SB1656" or "S 1656". Run a fuzzy lookup if exact failed.
    if (bills && bills.length === 0) {
      const compact = candidate.replace(/\s+/g, "");
      const noChamberPrefix = candidate.replace(/^[A-Z]+\s/, "");
      const { data: fuzzy } = await sb
        .from("bills")
        .select("id, state, bill_number, active, last_action_at")
        .eq("state", a.locality)
        .or(`bill_number.eq.${compact},bill_number.ilike.%${noChamberPrefix}%`)
        .eq("active", true);
      // Be VERY conservative — only include fuzzy matches whose bill_number
      // has the same digit suffix
      for (const f of fuzzy ?? []) {
        if (f.bill_number?.replace(/\s+/g, "").endsWith(noChamberPrefix)) {
          matches.push(f);
        }
      }
    }
  }
  // Dedup
  matches = [...new Map(matches.map(m => [m.id, m])).values()];

  if (matches.length === 0) {
    noMatch++;
    continue;
  }
  if (matches.length > 1) {
    multiMatch++;
    if (multiMatch < 10) {
      console.log(`  ⚠ ${a.locality} · ${a.title?.slice(0, 80)} → ${matches.length} matches: ${matches.map(m => m.bill_number).join(", ")}`);
    }
    continue;
  }
  const bill = matches[0];
  console.log(`  ✓ ${a.locality} · ${bill.bill_number} ← "${a.title?.slice(0, 70)}"`);
  if (!DRY) {
    const { error } = await sb.from("policy_alerts").update({ bill_id: bill.id }).eq("id", a.id);
    if (error) {
      console.error(`    ✗ ${error.message?.slice(0, 100)}`);
      continue;
    }
  }
  linked++;
  stats.set(a.locality, (stats.get(a.locality) ?? 0) + 1);
}

console.log(`\nDone. linked=${linked}, noMatch=${noMatch}, multiMatch=${multiMatch}, noPattern=${noPattern}, skipped(non-state)=${skipped}.`);
console.log(`\nBy state:`);
for (const [state, n] of [...stats.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${state}: ${n}`);
}

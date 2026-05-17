#!/usr/bin/env node
/**
 * Backfill / refresh news_items.bill_id from two sources:
 *
 *   1. policy_alerts linkage: when news_items.policy_alert_id is set
 *      AND that policy_alert has a bill_id, copy it directly.
 *
 *   2. Bill-number regex on title + summary: extract bill numbers like
 *      "SB 154", "HB 1077", "H.B. 283", "AB 322", "LD 1546" and match
 *      against bills.bill_number where bills.state = news_items.state.
 *      Requires state match to avoid spurious cross-state matches —
 *      "SB 154" exists in every state's session.
 *
 * The 2-stage chain is intentional: stage 1 is exact (alert system has
 * the correct linkage) and cheap, stage 2 is heuristic and slower.
 *
 * Idempotent. Sets bill_correlation_attempted_at on every row processed
 * so re-runs skip rows we've already evaluated. Use --refresh to ignore
 * the attempted-at timestamp and re-evaluate everything.
 *
 * Usage:
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --refresh
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --dry-run
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --limit 500
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const REFRESH = args.includes("--refresh");
const LIMIT = parseInt(args[args.indexOf("--limit") + 1] ?? "5000", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Bill-number regex. Matches common chamber+number patterns:
//   SB 154, S.B. 154, S 154, S-154, S154, SB154
//   HB 1077, H.B. 1077, H 1077, H-1077, etc.
//   AB 322 (CA assembly), AR (AR resolutions), LD (ME bills)
//   HR, HJR, SR, SJR, HCR, SCR, SJM, HJM (joint resolutions)
//   SF / HF (MN/IA files)
//
// We extract a normalized "PREFIX NUM" form e.g. "SB 154", "HB 1077",
// which matches our bills.bill_number conventions. We strip dashes and
// periods then re-add a single space.
// =============================================================
const BILL_NUMBER_RE =
  /\b(S\.?B\.?|H\.?B\.?|A\.?B\.?|H\.?R\.?|S\.?R\.?|H\.?J\.?R\.?|S\.?J\.?R\.?|H\.?C\.?R\.?|S\.?C\.?R\.?|S\.?J\.?M\.?|H\.?J\.?M\.?|S\.?F\.?|H\.?F\.?|L\.?D\.?|L\.?C\.?|A|H|S)[\s.\-]*(\d{1,5})\b/gi;

function extractBillNumbers(text) {
  if (!text) return [];
  const out = new Set();
  let m;
  // Reset regex state because BILL_NUMBER_RE is global
  BILL_NUMBER_RE.lastIndex = 0;
  while ((m = BILL_NUMBER_RE.exec(text)) !== null) {
    const prefix = m[1].replace(/[.\s\-]/g, "").toUpperCase();
    const num = m[2];
    if (num.length < 1 || num.length > 5) continue;
    // Bare single-letter prefix ("A", "H", "S") is the trickiest case:
    // it can match unrelated phrases ("S 1 building", "A 240 device").
    // We still emit it but it must hit BOTH the state-scope AND the
    // bills lookup to count — those constraints filter false positives
    // because most random "S 154"-looking strings won't be a bill in
    // the article's state.
    out.add(`${prefix} ${num}`);
  }
  return [...out];
}

// Some states use specific suffixes — normalize before comparing.
// e.g. LegiScan returns "S 154" while OpenStates returns "SB 154".
// We just check for either form in the candidate bills.
function billNumberVariants(canon) {
  const [pref, num] = canon.split(" ");
  const out = new Set([canon]);
  // Strip a trailing B from SB/HB/AB to handle "S 154" vs "SB 154"
  if (pref.endsWith("B")) out.add(`${pref.slice(0, -1)} ${num}`);
  if (pref.length === 1) out.add(`${pref}B ${num}`);
  return [...out];
}

const t0 = Date.now();

// =============================================================
// Stage 1: copy bill_id from policy_alerts
// =============================================================
console.log("Stage 1: copying bill_id from policy_alerts…");
let stage1 = 0;
{
  // Alert-driven: pull all alerts that HAVE a bill_id first, then
  // find news_items linked to those alerts. Inverting from news-first
  // ensures we pick up every linked news_item even if it's outside
  // a single LIMIT batch.
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("id, bill_id")
    .not("bill_id", "is", null);
  const alertToBill = new Map((alerts ?? []).map((a) => [a.id, a.bill_id]));
  console.log(`  ${alertToBill.size} policy_alerts have bill_id`);

  if (alertToBill.size > 0) {
    const { data: rows } = await sb
      .from("news_items")
      .select("id, policy_alert_id")
      .in("policy_alert_id", [...alertToBill.keys()])
      .is("bill_id", null);
    console.log(`  ${rows?.length ?? 0} news_items linked to those alerts but missing bill_id`);

    const toUpdate = (rows ?? [])
      .map((r) => ({ id: r.id, bill_id: alertToBill.get(r.policy_alert_id) }))
      .filter((r) => r.bill_id);

    if (!DRY_RUN) {
      for (const u of toUpdate) {
        await sb.from("news_items")
          .update({ bill_id: u.bill_id, bill_correlation_attempted_at: new Date().toISOString() })
          .eq("id", u.id);
      }
    }
    stage1 = toUpdate.length;
  }
  console.log(`  linked ${stage1} via policy_alerts`);
}

// =============================================================
// Stage 2: regex match titles/summaries → bill_number + state
// =============================================================
console.log("\nStage 2: bill-number regex match against title+summary…");
let stage2 = 0;
let stage2_attempted = 0;
let stage2_multi = 0;
{
  let q = sb
    .from("news_items")
    .select("id, state, title, summary")
    .eq("active", true)
    .is("bill_id", null)
    .not("state", "is", null);
  if (!REFRESH) q = q.is("bill_correlation_attempted_at", null);
  q = q.order("published_at", { ascending: false }).limit(LIMIT);
  const { data: rows } = await q;

  if (rows && rows.length > 0) {
    // Pre-load all kratom-relevant bills indexed by state+bill_number for
    // fast lookup. The bills table is small (~1000 rows) so we can hold
    // it all in memory.
    const { data: bills } = await sb
      .from("bills")
      .select("id, state, bill_number")
      .eq("active", true);

    const byKey = new Map(); // "STATE:BILLNUM" → id
    for (const b of bills ?? []) {
      if (!b.state || !b.bill_number) continue;
      // Normalize bill_number to "PREF NUM" with a single space, uppercase
      const normalized = String(b.bill_number).toUpperCase().replace(/[.\s\-]+/g, " ").replace(/\s+/g, " ").trim();
      byKey.set(`${b.state.toUpperCase()}:${normalized}`, b.id);
    }
    console.log(`  loaded ${byKey.size} bills for lookup`);

    const updates = [];
    for (const r of rows) {
      stage2_attempted++;
      const text = `${r.title ?? ""}\n${r.summary ?? ""}`;
      const found = extractBillNumbers(text);
      if (found.length === 0) {
        updates.push({ id: r.id, bill_id: null, reason: "no-bill-numbers-found" });
        continue;
      }
      // Try every extracted number + variant against this state
      const stateUC = r.state.toUpperCase();
      const matched = new Set();
      for (const canon of found) {
        for (const v of billNumberVariants(canon)) {
          const billId = byKey.get(`${stateUC}:${v}`);
          if (billId) matched.add(billId);
        }
      }
      if (matched.size === 0) {
        updates.push({ id: r.id, bill_id: null, reason: `no-state-match[${found.join(",")}]` });
      } else if (matched.size === 1) {
        updates.push({ id: r.id, bill_id: [...matched][0], reason: `single-match[${found.join(",")}]` });
      } else {
        // Multiple bills match — could be a news article covering
        // several related bills. Pick the first deterministically but
        // log it for review. (We don't yet have a many-to-many table.)
        stage2_multi++;
        updates.push({ id: r.id, bill_id: [...matched][0], reason: `multi-match[${matched.size}]` });
      }
    }

    if (!DRY_RUN) {
      for (const u of updates) {
        await sb.from("news_items")
          .update({
            bill_id: u.bill_id ?? null,
            bill_correlation_attempted_at: new Date().toISOString(),
          })
          .eq("id", u.id);
        if (u.bill_id) stage2++;
      }
    } else {
      stage2 = updates.filter((u) => u.bill_id).length;
    }
  }
  console.log(`  processed ${stage2_attempted}, linked ${stage2} (${stage2_multi} had multi-match)`);
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${stage1 + stage2} total links${DRY_RUN ? " (DRY RUN)" : ""}.`);

try {
  await sb.from("scraper_runs").insert({
    source: "correlate_news_to_bills",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: stage1 + stage2,
    notes: `stage1=${stage1}, stage2=${stage2} (of ${stage2_attempted} attempted, ${stage2_multi} multi)`,
  });
} catch { /* best-effort */ }

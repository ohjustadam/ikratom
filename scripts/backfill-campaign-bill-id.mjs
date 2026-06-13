#!/usr/bin/env node
/**
 * Backfill campaigns.bill_id for news-spawned auto-campaigns whose bill link
 * never got set.
 *
 * WHY: PR B made the campaign page gather EVERY internal /news outlet for its
 * story by unioning two keys — news_items.bill_id and the campaign's alerts'
 * policy_alert_id. A campaign with bill_id=NULL only sees the alert-keyed
 * subset, so it misses the bulk of the coverage (audit cited NC campaign
 * 449d76c8 → bill b6bf8886, whose 14-outlet news set is keyed on bill_id).
 *
 * Migration 0074 already backfilled campaigns.bill_id FROM the linked alert's
 * bill_id — but it can't help when the ALERT's own bill_id is null and the
 * bill link lives only on the news_items (the common news-spawned case). This
 * script closes that gap: for each auto-generated campaign with bill_id=NULL,
 * derive the bill from
 *   1. its linked alert(s)' bill_id, else
 *   2. the bill_id carried by the news_items linked to those alerts.
 * It links ONLY when the evidence points to a single, unambiguous bill and the
 * bill's state agrees with the campaign's state (when both are set). Ambiguous
 * or cross-state cases are reported and skipped — never guessed.
 *
 * READ-ONLY by default (dry-run). Pass --apply to write (owner-gated prod write).
 *   node --env-file=.env.local scripts/backfill-campaign-bill-id.mjs           # dry-run
 *   node --env-file=.env.local scripts/backfill-campaign-bill-id.mjs --apply   # write
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PAGE = 1000;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

async function fetchNullBillCampaigns() {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("campaigns")
      .select("id, slug, title, state, bill_id, active, review_state, auto_generated")
      .is("bill_id", null)
      .eq("auto_generated", true)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) { console.error("campaign query failed:", error.message); process.exit(1); }
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  // Only ONE auto-campaign may hold a given bill_id (unique idx
  // campaigns_one_auto_per_bill_idx). When several candidates map to the same
  // bill, the link must go to the live/canonical one — so process ACTIVE
  // campaigns first, then by review_state, so the best campaign wins the bill.
  const stateRank = { manual: 0, auto_active: 1, pending_review: 2 };
  all.sort((a, b) =>
    Number(b.active) - Number(a.active) ||
    (stateRank[a.review_state] ?? 9) - (stateRank[b.review_state] ?? 9));
  return all;
}

/** Current auto-campaign holding this bill_id, if any (the unique-index owner). */
async function currentHolder(billId) {
  const { data } = await sb
    .from("campaigns")
    .select("id, slug, active, review_state")
    .eq("bill_id", billId)
    .eq("auto_generated", true)
    .maybeSingle();
  return data ?? null;
}

/** Resolve the single bill this campaign should anchor to, or a reason it can't. */
async function resolveBill(c) {
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("id, bill_id")
    .eq("campaign_id", c.id);
  const alertIds = (alerts ?? []).map((a) => a.id);
  if (alertIds.length === 0) return { skip: "no linked alert" };

  // 1. Bill linked directly on the alert(s).
  let billIds = uniq((alerts ?? []).map((a) => a.bill_id));
  let via = "alert.bill_id";

  // 2. Fall back to the bill carried by the linked news_items.
  if (billIds.length === 0) {
    const { data: news } = await sb
      .from("news_items")
      .select("bill_id")
      .in("policy_alert_id", alertIds)
      .not("bill_id", "is", null);
    billIds = uniq((news ?? []).map((n) => n.bill_id));
    via = "news_items.bill_id";
  }

  if (billIds.length === 0) return { skip: "no bill on alert or news" };
  if (billIds.length > 1) return { skip: `ambiguous (${billIds.length} candidate bills)` };

  const billId = billIds[0];
  const { data: bill } = await sb
    .from("bills")
    .select("id, bill_number, state, title")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return { skip: "candidate bill row not found" };

  // Cross-state guard: never link a campaign to a bill from a different state.
  if (c.state && bill.state && c.state !== bill.state) {
    return { skip: `cross-state mismatch (campaign=${c.state}, bill=${bill.state} ${bill.bill_number})` };
  }
  return { billId, via, bill };
}

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — backfilling campaigns.bill_id for news-spawned auto-campaigns\n`);

  const campaigns = await fetchNullBillCampaigns();
  console.log(`${campaigns.length} auto-generated campaign(s) with bill_id=NULL.\n`);

  let linked = 0, skipped = 0, writeErrors = 0;
  const skipReasons = {};
  let shown = 0;

  for (const c of campaigns) {
    const r = await resolveBill(c);
    if (r.skip) {
      skipped++;
      skipReasons[r.skip] = (skipReasons[r.skip] ?? 0) + 1;
      continue;
    }

    // The unique index allows only one auto-campaign per bill. We only ever
    // FILL a NULL → we never clear/reassign a link another campaign already
    // holds (that "promotion" was considered and declined by the owner — when
    // a dead duplicate holds the link, the right cure is collapsing the dup via
    // the dedup system, not churning bill_id here).
    const holder = await currentHolder(r.billId);
    if (holder && holder.id !== c.id) {
      const reason = holder.active
        ? "bill already held by active campaign"
        : "bill held by inactive dup (not auto-reassigned)";
      skipped++;
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
      continue;
    }

    linked++;
    if (shown < 60 || APPLY) {
      shown++;
      console.log(`• [${c.slug}] ${c.id.slice(0, 8)}`);
      console.log(`    → bill ${r.billId.slice(0, 8)}  ${r.bill.state ?? "?"} ${r.bill.bill_number ?? ""}  (via ${r.via})`);
      console.log(`      ${(r.bill.title ?? "").slice(0, 90)}`);
    }
    if (APPLY) {
      const { error } = await sb.from("campaigns").update({ bill_id: r.billId }).eq("id", c.id);
      if (error) { writeErrors++; console.log(`    ✗ update failed: ${error.message}`); }
    }
  }

  console.log(`\nSummary: ${campaigns.length} candidates — ${linked} would link, ${skipped} skipped.`);
  if (Object.keys(skipReasons).length) {
    console.log("  Skip reasons:");
    for (const [k, n] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n.toString().padStart(4)}  ${k}`);
    }
  }
  if (APPLY) {
    console.log(`\n✓ Apply complete. ${linked} linked, ${writeErrors} write errors.`);
    try {
      await sb.from("scraper_runs").insert({
        source: "backfill_campaign_bill_id",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: writeErrors > 0 ? "error" : linked > 0 ? "success" : "empty",
        rows_updated: linked,
        notes: `${linked} linked, ${skipped} skipped, ${writeErrors} errors`,
      });
    } catch { /* best-effort */ }
  } else {
    console.log(`\nDry-run only. Re-run with --apply to write (owner-gated).`);
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });

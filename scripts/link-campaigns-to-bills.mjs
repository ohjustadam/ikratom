#!/usr/bin/env node
/**
 * link-campaigns-to-bills.mjs — wire orphan bill-campaigns to their bill.
 *
 * Some auto-generated campaigns are LIVE (active=true) yet carry bill_id=NULL,
 * so they can't inherit their bill's news/timeline via the campaign-page gather
 * (src/app/campaigns/[slug]/page.tsx, #605). This happens when the alert that
 * spawned the campaign had no bill_id at insert time (bill correlation is async,
 * the auto_campaign_on_alert trigger copies bill_id only at creation — mig 0074).
 *
 * This script finds those orphans and resolves their true bill, preferring the
 * GROUND-TRUTH FK (the campaign's alerts' bill_id) over the lossy slug/topic_key.
 * Resolution order per campaign (active=true, bill_id IS NULL):
 *   1. distinct non-null bill_id across ALL its policy_alerts (any moderation
 *      status — a rejected procedural alert still names the right bill);
 *   2. topic_key of the form `bill:<ST>|<type><num>` → (state, bill_number) lookup;
 *   3. slug parse — `stop-<st>-<billtok>` or `alert-<st>-<st>-<billtok>-…`
 *      (the trailing 6-hex slug hash is NOT a bill — it is stripped first).
 * A candidate is accepted only when these agree (or only one resolves) AND the
 * bill exists. The slug/topic_key is otherwise a cross-check, not the source.
 *
 * Two actions on --apply, mirroring the owner decision (2026-06-14):
 *   • LINK   — orphan backed by ≥1 APPROVED alert → set campaigns.bill_id.
 *   • DEACTIVATE — auto-generated orphan whose alerts are ALL rejected (no
 *     approved one) is procedural noise the autonomy engine left live (e.g.
 *     AZ HB 2415's "Senator moved to return the bill" motions) → set
 *     active=false + review_state='rejected' rather than promote it with a link.
 *
 * SAFETY — the one-auto-campaign-per-bill constraint:
 *   `campaigns_one_auto_per_bill_idx` is UNIQUE on (bill_id) WHERE
 *   auto_generated=true AND bill_id IS NOT NULL — and (after mig 0203) also
 *   review_state NOT IN ('rejected','superseded'). So a DEAD auto-campaign no
 *   longer squats the slot. The collision check below uses that same live-only
 *   predicate, so it predicts post-0203 behavior even before the index is
 *   rebuilt. If a LIVE auto-campaign still holds the slot we report BLOCKED
 *   rather than attempt a doomed (23505) write.
 *
 * READ-ONLY by default (dry-run). Pass --apply to write (owner-gated prod write).
 * REQUIRES migration 0203 applied before --apply, or the LINK leg may 23505 on a
 * dead squatter the rebuilt index would otherwise have released.
 *   node --env-file=.env.local scripts/link-campaigns-to-bills.mjs            # dry-run
 *   node --env-file=.env.local scripts/link-campaigns-to-bills.mjs --apply    # write
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PAGE = 1000;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Slug bill-token: a bill-type prefix immediately followed by its number, e.g.
// "hb2415", "hb-2415", "s-5531", "a4034". Types match real DB bill_number
// prefixes (HB SB HF SF HSB LB HR SR HJR SJR HJ HC AB A S H). Longest-first so
// "hb" wins over "h". The token must sit at the START of the remainder (right
// after the state), never mid-headline.
const BILL_TYPES = ["hsb", "hjr", "sjr", "hb", "sb", "hf", "sf", "lb", "hr", "sr", "ab", "hj", "hc", "a", "s", "h"];
const TYPE_ALT = BILL_TYPES.join("|");
const SLUG_HASH = /-[0-9a-f]{6}$/; // trailing collision-suffix the trigger appends

function parseSlugBill(slug) {
  // strip the trailing 6-hex hash so it can't be misread as a bill number
  const core = slug.replace(SLUG_HASH, "");
  // stop-<st>-<billtok>  (whole remainder is the bill)
  let m = core.match(new RegExp(`^stop-([a-z]{2})-(${TYPE_ALT})-?0*(\\d{1,5})[a-z]?$`));
  if (m) return { state: m[1].toUpperCase(), type: m[2].toUpperCase(), num: m[3] };
  // alert-<st>-<st>-<billtok>-...  (doubled state ⇒ the alert names a specific bill)
  m = core.match(new RegExp(`^alert-([a-z]{2})-\\1-(${TYPE_ALT})-?0*(\\d{1,5})[a-z]?(?:-|$)`));
  if (m) return { state: m[1].toUpperCase(), type: m[2].toUpperCase(), num: m[3] };
  return null;
}

function parseTopicKeyBill(topic_key) {
  if (!topic_key) return null;
  // `bill:AZ|hb2415`
  const m = topic_key.match(/^bill:([A-Z]{2})\|([a-z]+)0*(\d{1,5})$/i);
  if (!m) return null;
  return { state: m[1].toUpperCase(), type: m[2].toUpperCase(), num: m[3] };
}

// Does a resolved bill row agree with a slug/topic_key parse? Compares state +
// numeric core + type, ignoring zero-padding and the H/HB·S/SB house-prefix
// nuance (slug "h864" ↔ DB "H 864"; "a4034" ↔ "A 4034").
function billMatchesParse(bill, p) {
  if (!bill || !p) return false;
  if (bill.state !== p.state) return false;
  const bn = bill.bill_number.toUpperCase().replace(/\s+/g, "");
  const want = `${p.type}${p.num}`;
  const wantPad = `${p.type}${p.num.padStart(5, "0")}`;
  const bnNoPad = bn.replace(/([A-Z]+)0*(\d+)/, "$1$2");
  return bn === want || bn === wantPad || bnNoPad === want;
}

async function all(query) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) { console.error("query failed:", error.message); process.exit(1); }
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`\n${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — linking active orphan campaigns to their bill\n`);

  // Active campaigns missing a bill link.
  const orphans = await all(
    sb.from("campaigns")
      .select("id, slug, title, state, auto_generated, review_state, topic_key")
      .is("bill_id", null)
      .eq("active", true)
      .order("slug"),
  );
  console.log(`${orphans.length} active campaigns with bill_id IS NULL\n`);

  const writable = [];   // { campaign, bill, via }     — LINK (approved-alert backed)
  const deactivate = []; // { campaign, bill }          — auto-orphan, all alerts rejected (noise)
  const blocked = [];    // { campaign, bill, via, squatters } — a LIVE auto-campaign still holds the slot
  const disagree = [];   // { campaign, bill, parse } — slug bill ≠ alert bill
  const misattach = [];  // out-of-scope campaign that owns an alert with a bill_id (data-bug signal)
  let outOfScope = 0;

  for (const c of orphans) {
    const slugParse = parseSlugBill(c.slug);
    const topicParse = parseTopicKeyBill(c.topic_key);
    const parse = slugParse ?? topicParse;

    // SCOPE GATE: only campaigns whose own slug/topic_key encodes a bill. The
    // evergreen `*-introduce-yourself` campaigns are generic by design and must
    // never be pinned to one bill, even if a stray alert with a bill_id got
    // attached to them — that mis-attachment is a separate data bug we only flag.
    const { data: alerts } = await sb.from("policy_alerts")
      .select("bill_id, moderation_status").eq("campaign_id", c.id);
    const alertBillIds = [...new Set((alerts ?? []).map((a) => a.bill_id).filter(Boolean))];

    if (!parse) {
      outOfScope++;
      if (alertBillIds.length > 0) misattach.push({ campaign: c, alertBillIds });
      continue;
    }

    // Resolve which bill. Ground-truth is the alert FK when it agrees with the
    // slug/topic parse; otherwise fall back to a (state, bill_number) lookup.
    let bill = null;
    let via = null;

    if (alertBillIds.length >= 1) {
      const { data: cands } = await sb.from("bills")
        .select("id, state, bill_number, title, active").in("id", alertBillIds);
      const hit = (cands ?? []).find((b) => billMatchesParse(b, parse));
      if (hit) { bill = hit; via = alertBillIds.length === 1 ? "alert.bill_id = slug" : "alert.bill_id ∩ slug"; }
      else if ((cands ?? []).length > 0) {
        // alert names a DIFFERENT bill than the slug — suspicious, never auto-write
        disagree.push({ campaign: c, bill: cands[0], parse });
        continue;
      }
    }
    if (!bill) {
      // no alert FK — resolve via slug/topic_key (state, bill_number)
      const variants = [`${parse.type} ${parse.num}`, `${parse.type} ${parse.num.padStart(5, "0")}`,
        `${parse.type}${parse.num}`];
      const { data: cands } = await sb.from("bills")
        .select("id, state, bill_number, title, active")
        .eq("state", parse.state).in("bill_number", variants);
      if (cands && cands.length === 1) { bill = cands[0]; via = slugParse ? "slug lookup" : "topic_key lookup"; }
      else if (cands && cands.length > 1) {
        const act = cands.filter((b) => b.active);
        if (act.length === 1) { bill = act[0]; via = "slug lookup (active of N)"; }
      }
    }

    if (!bill) { outOfScope++; continue; }

    const hasApprovedAlert = (alerts ?? []).some((a) => a.moderation_status === "approved");

    // SAFETY: would a bill_id write violate campaigns_one_auto_per_bill_idx?
    // Use the post-0203 LIVE-only predicate so the dry-run predicts the rebuilt
    // index: a rejected/superseded squatter no longer counts.
    let squatters = [];
    if (c.auto_generated) {
      const { data: others } = await sb.from("campaigns")
        .select("id, slug, active, review_state")
        .eq("bill_id", bill.id).eq("auto_generated", true).neq("id", c.id)
        .not("review_state", "in", "(rejected,superseded)");
      squatters = others ?? [];
    }

    if (squatters.length > 0) { blocked.push({ campaign: c, bill, via, squatters }); continue; }

    // LINK only when an approved alert backs the campaign. An auto-generated
    // orphan with no approved alert (all rejected) is procedural noise → mark it
    // for deactivation instead of promoting it with a bill link.
    if (hasApprovedAlert) writable.push({ campaign: c, bill, via });
    else if (c.auto_generated) deactivate.push({ campaign: c, bill });
    else outOfScope++; // manual campaign w/ no approved alert — leave it alone
  }

  // ---- report ----
  const fmtBill = (b) => `${b.state} ${b.bill_number} [${b.id.slice(0, 8)}]${b.active ? "" : " (bill inactive)"}`;

  console.log(`✅ LINK — ${writable.length} (approved-alert backed, no live-slot conflict):`);
  for (const r of writable) {
    console.log(`  ${r.campaign.slug}`);
    console.log(`     → ${fmtBill(r.bill)}  via ${r.via}`);
  }

  console.log(`\n🚫 DEACTIVATE — ${deactivate.length} (auto-orphan, all alerts rejected → procedural noise):`);
  for (const r of deactivate) {
    console.log(`  ${r.campaign.slug}  (${r.campaign.review_state})`);
    console.log(`     bill in slug: ${fmtBill(r.bill)} — set active=false, review_state='rejected'`);
  }

  console.log(`\n⛔ BLOCKED — ${blocked.length} (a LIVE auto-campaign still holds the slot; UPDATE would 23505):`);
  for (const r of blocked) {
    console.log(`  ${r.campaign.slug}  (auto=${r.campaign.auto_generated}, ${r.campaign.review_state})`);
    console.log(`     → ${fmtBill(r.bill)}  via ${r.via}`);
    for (const s of r.squatters) console.log(`     ✗ slot held by ${s.slug} [${s.id.slice(0, 8)}] active=${s.active} review=${s.review_state}`);
  }

  if (disagree.length > 0) {
    console.log(`\n⚠️  DISAGREEMENT — ${disagree.length} (slug bill ≠ alert bill; never auto-written):`);
    for (const r of disagree) console.log(`  ${r.campaign.slug}: slug→${r.parse.state} ${r.parse.type} ${r.parse.num} but alert→${fmtBill(r.bill)}`);
  }

  if (misattach.length > 0) {
    console.log(`\n🐞 OUT-OF-SCOPE but owns a bill alert — ${misattach.length} (data-bug signal, NOT linked):`);
    for (const r of misattach.slice(0, 10)) console.log(`  ${r.campaign.slug} owns alert(s) for bill ${r.alertBillIds.map((b) => b.slice(0, 8)).join(", ")}`);
  }

  console.log(`\nℹ️  ${outOfScope} active orphans encode no resolvable bill (news-headline slugs, no bill in slug/topic_key) — left as-is.`);

  if (APPLY) {
    if (writable.length === 0 && deactivate.length === 0) { console.log(`\nNothing to write. No changes made.`); return; }
    let ok = 0, err = 0, off = 0;
    console.log(`\n— applying —`);
    for (const r of writable) {
      const { error } = await sb.from("campaigns").update({ bill_id: r.bill.id }).eq("id", r.campaign.id).is("bill_id", null);
      if (error) { err++; console.log(`  ✗ link ${r.campaign.slug}: ${error.message?.slice(0, 90)}`); }
      else { ok++; console.log(`  ✓ link ${r.campaign.slug} → ${r.bill.state} ${r.bill.bill_number}`); }
    }
    for (const r of deactivate) {
      const { error } = await sb.from("campaigns").update({
        active: false,
        review_state: "rejected",
        review_reason: "orphan auto-campaign: all source alerts rejected (procedural/non-actionable) — deactivated by link-campaigns-to-bills",
        reviewed_at: new Date().toISOString(),
      }).eq("id", r.campaign.id).eq("active", true);
      if (error) { err++; console.log(`  ✗ deactivate ${r.campaign.slug}: ${error.message?.slice(0, 90)}`); }
      else { off++; console.log(`  ✓ deactivate ${r.campaign.slug}`); }
    }
    console.log(`\n✓ Apply complete: ${ok} linked, ${off} deactivated, ${err} errors. (${blocked.length} blocked, not attempted.)`);
    try {
      await sb.from("scraper_runs").insert({
        source: "link_campaigns_to_bills",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: err > 0 ? "error" : (ok + off) > 0 ? "success" : "empty",
        rows_updated: ok + off,
        notes: `${ok} linked, ${off} deactivated, ${err} err, ${blocked.length} blocked, ${outOfScope} no-bill`,
      });
    } catch { /* best-effort */ }
  } else {
    console.log(`\nDry-run only. Apply requires mig 0203 first, then --apply (owner-gated).`);
  }
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });

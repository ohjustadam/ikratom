#!/usr/bin/env node
/**
 * Cleanup pass for ACTIVE campaigns + alerts whose underlying fight has
 * concluded or whose news event is duplicate. Sibling to
 * cleanup-pending-campaigns.mjs (which handles pre-promotion triage);
 * this one handles POST-promotion drift.
 *
 * V2_KICKOFF §3.A0. Audit showed:
 *   - 104 active orphan campaigns (no bill_id), 53 of them
 *     auto_active (the cohort safe to auto-dedup; manual = admin made
 *     an intentional call, leave alone).
 *   - Bills that transition to terminal status (dead/enacted/vetoed)
 *     leave their linked campaigns active forever.
 *   - 25 action-required policy_alerts point at bills that are
 *     already dead/inactive — the "alert says do something but the
 *     fight is over" trust-eroder.
 *
 * Three idempotent passes (safe to re-run; matches cleanup-pending-
 * campaigns' --dry-run / --apply discipline):
 *
 *   Pass 1 — topic-cluster dedup of orphan auto_active campaigns.
 *            Reuses the topicKey() approach from cleanup-pending-
 *            campaigns: group by (state | kratom_kw | event_word),
 *            keep most-recent, supersede the rest.
 *
 *   Pass 2 — deactivate active campaigns whose linked bill is in a
 *            terminal status (dead/enacted/vetoed/failed/withdrawn)
 *            OR whose bill.active=false. The fight is over regardless
 *            of which side won — campaign should retire.
 *
 *   Pass 3 — expire action_required policy_alerts whose linked bill
 *            is terminal or inactive. Sets expires_at=now() so /pulse
 *            and the action queue hide them. Doesn't change
 *            moderation_status (keeps audit trail clean).
 *
 * Default is --dry-run. --apply must be explicit. --stale-months sets
 * the bill-action-age threshold for an OPTIONAL fourth pass (off by
 * default) that retires campaigns whose bill hasn't moved in N
 * months — conservative because between-session bills can look stale.
 *
 *   node --env-file=.env.local scripts/cleanup-stale-active-campaigns.mjs
 *   node --env-file=.env.local scripts/cleanup-stale-active-campaigns.mjs --apply
 *   node --env-file=.env.local scripts/cleanup-stale-active-campaigns.mjs --apply --stale-months 18
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;
const arg = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
const STALE_MONTHS = parseInt(arg("--stale-months", "0"), 10); // 0 = pass 4 disabled

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const t0 = Date.now();
console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE — applying changes"}\n`);

// Topic-cluster key — verbatim from cleanup-pending-campaigns.mjs so
// orphan auto_active campaigns dedup against the same buckets as
// pending_review ones would have, before they were promoted.
const KW_RX = /\b(kratom|mitragyna(?:[a-z]+)?|7-?o?h|gas[- ]?station)\b/i;
const EVENT_RX = /\b(ban|restrict|regulat|hearing|petition|schedule|crackdown|ordinance|enact|law|ruling|veto|sign|amend|advance|pass|repeal|reject|withdraw|approve|approv|stalls?|halts?|block)/i;
function topicKey(state, title) {
  const t = (title || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const kw = (t.match(KW_RX) || [])[1] || "unknown";
  const event = (t.match(EVENT_RX) || [])[1] || "unknown";
  return `${state || "?"}|${kw}|${event}`;
}

const TERMINAL = new Set(["dead", "enacted", "vetoed", "failed", "withdrawn"]);
const stats = { supersededOrphans: 0, deactivatedBillTerminal: 0, expiredAlerts: 0, deactivatedActionStale: 0 };

// Range-paginate a PostgREST query builder factory — without this, every
// select silently caps at 1000 rows (the documented Supabase cap) and rows
// past the window are never cleaned. (Audit 2026-07-16; pattern mirrors
// cleanup-pending-campaigns.mjs.)
async function fetchAll(buildQuery, pageSize = 1000) {
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) { console.error(`  fetchAll page ${from / pageSize} failed: ${error.message}`); break; }
    all.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

// ── Pass 1: dedup orphan auto_active campaigns by topic cluster ────
console.log("Pass 1: dedup orphan auto_active campaigns by topic cluster");
const orphans = await fetchAll(() => sb
  .from("campaigns")
  .select("id, slug, title, state, created_at, review_state")
  .eq("active", true)
  .eq("auto_generated", true)
  .eq("review_state", "auto_active")
  .is("bill_id", null)
  .order("id"));
console.log(`  ${orphans?.length ?? 0} orphan auto_active candidates`);

const clusters = new Map();
for (const c of orphans ?? []) {
  const k = topicKey(c.state, c.title);
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(c);
}
const dupClusters = [...clusters.entries()].filter(([, rs]) => rs.length > 1);
console.log(`  ${dupClusters.length} clusters with >1 orphan`);
for (const [key, rows] of dupClusters) {
  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const canonical = rows[0];
  const losers = rows.slice(1);
  console.log(`  [${key}] ${rows.length} → keep ${canonical.id.slice(0, 8)} "${(canonical.title ?? "").slice(0, 60)}"`);
  for (const l of losers) {
    console.log(`     supersede ${l.id.slice(0, 8)} "${(l.title ?? "").slice(0, 60)}"`);
    if (APPLY) {
      await sb.from("campaigns").update({
        review_state: "superseded",
        superseded_by: canonical.id,
        review_reason: `auto-deduped post-promotion: topic cluster ${key} (canonical=${canonical.id.slice(0, 8)})`,
        active: false,
        reviewed_at: new Date().toISOString(),
      }).eq("id", l.id);
    }
    stats.supersededOrphans++;
  }
}
console.log(`  → ${stats.supersededOrphans} ${DRY_RUN ? "would be" : ""} superseded\n`);

// ── Pass 2: deactivate campaigns whose bill is terminal/inactive ───
console.log("Pass 2: deactivate active campaigns whose linked bill is terminal or inactive");
const linked = await fetchAll(() => sb
  .from("campaigns")
  .select("id, slug, title, state, bill_id, bills:bill_id(id, bill_number, status, active, kratom_relevance, last_action_at)")
  .eq("active", true)
  .not("bill_id", "is", null)
  .order("id"));
const billTerminal = (linked ?? []).filter((c) => c.bills && (c.bills.active === false || TERMINAL.has((c.bills.status ?? "").toLowerCase())));
console.log(`  ${billTerminal.length} active campaigns whose bill is terminal/inactive`);
for (const c of billTerminal) {
  const reason = c.bills.active === false ? "bill.active=false" : `bill.status=${c.bills.status}`;
  console.log(`     deactivate ${c.id.slice(0, 8)} [${c.state}] ${c.bills.bill_number} (${reason}) — "${(c.title ?? "").slice(0, 60)}"`);
  if (APPLY) {
    await sb.from("campaigns").update({
      active: false,
      review_reason: `auto-retired: linked bill ${c.bills.bill_number} is ${reason} (cleanup-stale-active-campaigns)`,
      reviewed_at: new Date().toISOString(),
    }).eq("id", c.id);
  }
  stats.deactivatedBillTerminal++;
}
console.log(`  → ${stats.deactivatedBillTerminal} ${DRY_RUN ? "would be" : ""} retired\n`);

// ── Pass 3: expire action_required alerts on terminal/inactive bills ─
console.log("Pass 3: expire action_required policy_alerts on terminal/inactive bills");
const aalerts = await fetchAll(() => sb
  .from("policy_alerts")
  .select("id, title, locality, kind, bill_id, expires_at, moderation_status, bills:bill_id(bill_number, status, active)")
  .eq("action_required", true)
  .eq("moderation_status", "approved")
  .not("bill_id", "is", null)
  .order("id"));
const stale = (aalerts ?? []).filter((a) => a.bills && (a.bills.active === false || TERMINAL.has((a.bills.status ?? "").toLowerCase())));
// Only re-expire ones not already past their expires_at
const toExpire = stale.filter((a) => !a.expires_at || new Date(a.expires_at) > new Date());
console.log(`  ${stale.length} action_required alerts on terminal/inactive bills (${toExpire.length} still un-expired)`);
for (const a of toExpire) {
  console.log(`     expire ${a.id.slice(0, 8)} [${a.locality}] ${a.bills.bill_number} (status=${a.bills.status},active=${a.bills.active}) — "${(a.title ?? "").slice(0, 60)}"`);
  if (APPLY) {
    await sb.from("policy_alerts").update({
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", a.id);
  }
  stats.expiredAlerts++;
}
console.log(`  → ${stats.expiredAlerts} ${DRY_RUN ? "would be" : ""} expired\n`);

// ── Pass 4: optional — retire campaigns whose bill hasn't moved in N months ─
if (STALE_MONTHS > 0) {
  console.log(`Pass 4: retire campaigns whose bill has had no action in ${STALE_MONTHS}+ months`);
  const cutoff = new Date(Date.now() - STALE_MONTHS * 30 * 86_400_000).toISOString().slice(0, 10);
  const stalePast = (linked ?? []).filter((c) => c.bills && c.bills.active !== false && !TERMINAL.has((c.bills.status ?? "").toLowerCase()) && c.bills.last_action_at && c.bills.last_action_at < cutoff);
  console.log(`  ${stalePast.length} campaigns whose bill last moved before ${cutoff}`);
  for (const c of stalePast) {
    console.log(`     deactivate ${c.id.slice(0, 8)} [${c.state}] ${c.bills.bill_number} (last action ${c.bills.last_action_at})`);
    if (APPLY) {
      await sb.from("campaigns").update({
        active: false,
        review_reason: `auto-retired: bill ${c.bills.bill_number} no action since ${c.bills.last_action_at} (>${STALE_MONTHS}mo)`,
        reviewed_at: new Date().toISOString(),
      }).eq("id", c.id);
    }
    stats.deactivatedActionStale++;
  }
  console.log(`  → ${stats.deactivatedActionStale} ${DRY_RUN ? "would be" : ""} retired\n`);
} else {
  console.log(`Pass 4: skipped (--stale-months 0). Pass --stale-months 18 to retire bill-linked campaigns that haven't moved in 18mo.\n`);
}

// ── Telemetry — write to scraper_runs so /admin/automation sees it ─
if (APPLY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "daily_stale_campaign_cleanup",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: "success",
      rows_updated: stats.supersededOrphans + stats.deactivatedBillTerminal + stats.expiredAlerts + stats.deactivatedActionStale,
      notes: JSON.stringify(stats),
    });
  } catch (e) { console.warn(`(scraper_runs insert non-fatal: ${e.message})`); }
}

console.log(`━━━ Summary (${((Date.now() - t0) / 1000).toFixed(1)}s) ━━━`);
console.log(`Orphan auto_active superseded: ${stats.supersededOrphans}`);
console.log(`Bill-terminal/inactive retired: ${stats.deactivatedBillTerminal}`);
console.log(`Action-required alerts expired: ${stats.expiredAlerts}`);
console.log(`Action-stale campaigns retired: ${stats.deactivatedActionStale}`);
if (DRY_RUN) console.log(`\nDRY RUN — no rows modified. Add --apply to commit changes.`);

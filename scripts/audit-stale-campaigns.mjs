#!/usr/bin/env node
/**
 * READ-ONLY audit for V2_KICKOFF §3.A0 — stale campaigns/alerts +
 * per-state status accuracy. No DB writes.
 *
 * v2: also slice the orphaned-auto-campaign bucket by review_state +
 * age, because the first audit pass showed orphans dominate (104 of
 * 105 stale active campaigns) and we need to know whether they're
 * already in pending_review (cleanup-pending-campaigns handles those)
 * or sitting in the active feed.
 *
 *   node --env-file=.env.local scripts/audit-stale-campaigns.mjs
 *   node --env-file=.env.local scripts/audit-stale-campaigns.mjs --months 12
 *   node --env-file=.env.local scripts/audit-stale-campaigns.mjs --json
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : dflt; };
const MONTHS = parseInt(arg("--months", "12"), 10);
const JSON_OUT = args.includes("--json");
const SAMPLE = 8;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const now = new Date();
const staleCutoff = new Date(now.getTime() - MONTHS * 30 * 86_400_000).toISOString().slice(0, 10);
const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);

const report = { generatedAt: now.toISOString(), staleCutoffDate: staleCutoff, monthsThreshold: MONTHS, buckets: {} };
function log(...x) { if (!JSON_OUT) console.log(...x); }

const { data: activeCampaigns } = await sb
  .from("campaigns")
  .select("id, slug, title, state, bill_id, auto_generated, review_state, created_at, starts_at, ends_at, bills:bill_id(id, bill_number, state, status, active, kratom_relevance, last_action_at, last_synced_at)")
  .eq("active", true);
log(`Total active campaigns: ${activeCampaigns.length}`);
report.totalActiveCampaigns = activeCampaigns.length;

const bucketA = activeCampaigns.filter((c) => c.bill_id === null);
const bucketB = activeCampaigns.filter((c) => c.bills && c.bills.active === false);
const TERMINAL = new Set(["dead", "enacted", "vetoed", "failed", "withdrawn"]);
const bucketC = activeCampaigns.filter((c) => c.bills && TERMINAL.has((c.bills.status ?? "").toLowerCase()));
const bucketD = activeCampaigns.filter((c) => c.bills && c.bills.last_action_at && c.bills.last_action_at < staleCutoff && !TERMINAL.has((c.bills.status ?? "").toLowerCase()) && c.bills.active !== false);

report.buckets.A_orphanedNoBillLink = { count: bucketA.length };
report.buckets.B_billInactive = { count: bucketB.length };
report.buckets.C_billTerminalStatus = { count: bucketC.length, sample: bucketC.slice(0, SAMPLE).map((c) => ({ id: c.id, slug: c.slug, state: c.state, bill_number: c.bills?.bill_number, bill_status: c.bills?.status, last_action_at: c.bills?.last_action_at, review_state: c.review_state })) };
report.buckets.D_billActionStale = { count: bucketD.length };

// New: slice bucket A by review_state + age, since orphans dominate.
const ageBuckets = { "0-30d": 0, "30-90d": 0, "90-180d": 0, "180d+": 0 };
const reviewStateCount = {};
for (const c of bucketA) {
  const ageDays = Math.floor((now - new Date(c.created_at)) / 86_400_000);
  const k = ageDays < 30 ? "0-30d" : ageDays < 90 ? "30-90d" : ageDays < 180 ? "90-180d" : "180d+";
  ageBuckets[k]++;
  reviewStateCount[c.review_state ?? "(null)"] = (reviewStateCount[c.review_state ?? "(null)"] ?? 0) + 1;
}
report.buckets.A_byAge = ageBuckets;
report.buckets.A_byReviewState = reviewStateCount;
report.buckets.A_orphanSamples = bucketA.slice(0, SAMPLE).map((c) => ({ id: c.id, state: c.state, auto_generated: c.auto_generated, review_state: c.review_state, ageDays: Math.floor((now - new Date(c.created_at)) / 86_400_000), title: c.title.slice(0, 80) }));

log(`\nA. Orphaned (bill_id null):                 ${bucketA.length}`);
log(`   by age:`, ageBuckets);
log(`   by review_state:`, reviewStateCount);
log(`B. Linked bill active=false:                 ${bucketB.length}`);
log(`C. Linked bill status terminal:              ${bucketC.length}`);
log(`D. Linked bill last action > ${MONTHS}mo old:        ${bucketD.length}`);

// Action-required alerts
const { data: actionAlerts } = await sb
  .from("policy_alerts")
  .select("id, kind, severity, title, locality, bill_id, action_required, campaign_id, expires_at, created_at, moderation_status, bills:bill_id(id, bill_number, status, active, last_action_at)")
  .eq("action_required", true)
  .eq("moderation_status", "approved");
const staleAlerts = (actionAlerts ?? []).filter((a) => {
  if (!a.bills) return a.bill_id !== null;
  if (a.bills.active === false) return true;
  if (TERMINAL.has((a.bills.status ?? "").toLowerCase())) return true;
  if (a.bills.last_action_at && a.bills.last_action_at < staleCutoff) return true;
  return false;
});
report.buckets.E_staleActionRequiredAlerts = { count: staleAlerts.length, ofTotal: actionAlerts?.length ?? 0 };
log(`\nE. Action-required policy_alerts on stale bills: ${staleAlerts.length} of ${actionAlerts?.length ?? 0}`);

// Per-state competing-bill conflation
const { data: stateAntiBills } = await sb
  .from("bills")
  .select("id, state, bill_number, status, active, last_action_at, scope")
  .eq("active", true)
  .eq("kratom_relevance", "anti")
  .neq("status", "dead")
  .gte("last_action_at", yearAgo);
const byState = new Map();
for (const b of stateAntiBills ?? []) { if (!byState.has(b.state)) byState.set(b.state, []); byState.get(b.state).push(b); }
const conflated = [...byState.entries()].filter(([, bills]) => bills.length > 1).map(([state, bills]) => ({ state, bill_count: bills.length }));
conflated.sort((a, b) => b.bill_count - a.bill_count);
report.buckets.F_statesWithCompetingActiveAntiBills = { count: conflated.length, breakdown: conflated };
log(`\nF. States with multiple active anti bills: ${conflated.length}`);
if (!JSON_OUT) for (const s of conflated.slice(0, SAMPLE)) log(`   ${s.state}: ${s.bill_count} active anti bills`);

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  log("\n━━━ Summary ━━━");
  log(`Stale active campaigns: ${bucketA.length + bucketB.length + bucketC.length + bucketD.length} of ${activeCampaigns.length} (${Math.round(100 * (bucketA.length + bucketB.length + bucketC.length + bucketD.length) / activeCampaigns.length)}%)`);
  log(`Stale action-required alerts: ${staleAlerts.length} of ${actionAlerts?.length ?? 0}`);
  log(`Companion-conflation candidates: ${conflated.length} states`);
  log(`\nREAD-ONLY. No rows modified.`);
}

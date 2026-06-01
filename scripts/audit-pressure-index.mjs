/**
 * audit-pressure-index.mjs — READ-ONLY proof of the "Pressure Index".
 *
 * Idea (owner, 2026-06-01, see private/PRESSURE_INDEX.md): in intel work,
 * tracking *pressure* (observable force being applied) beats tracking
 * *money* (laggy, hideable). Pressure is symmetric — both sides generate
 * it — so per jurisdiction we model:
 *   P_against = anti bills (by stage) + enforcement news + bill alerts
 *   P_for     = advocate actions (campaign_actions) + pro bills
 *   gap       = P_against - P_for   (positive = opposition winning)
 *
 * Everything is exponentially time-decayed (30-day half-life) so RECENT
 * pressure dominates. This script ONLY reads + prints a ranked board —
 * no writes, no new scrapers. It exists to validate the weights/model on
 * real data before we build a materialized view + /intel/pressure board.
 *
 * Usage: node --env-file=.env.local scripts/audit-pressure-index.mjs
 *        [--days 365]   lookback window for events (default 365)
 *
 * v1 caveats (intentional, refine later):
 *  - Weights are hand-set (see WEIGHTS below).
 *  - P_for counts raw action volume, not unique advocates (anti-gaming TODO).
 *  - municipal_meetings (5 rows) + legislator_events (0 rows) omitted — too sparse.
 *  - policy_alerts have no state column; state is derived via linked bill_id.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const argDays = Number((process.argv.find((a) => a.startsWith("--days="))?.split("=")[1]) ?? process.argv[process.argv.indexOf("--days") + 1]);
const LOOKBACK_DAYS = Number.isFinite(argDays) && argDays > 0 ? argDays : 365;
const NOW = Date.now();
const HALF_LIFE_DAYS = 30;
const MS_DAY = 86_400_000;

// Exponential decay: weight halves every HALF_LIFE_DAYS. Events older than
// the lookback window are dropped before this is called.
function decay(ts) {
  if (!ts) return 0;
  const ageDays = (NOW - new Date(ts).getTime()) / MS_DAY;
  if (ageDays < 0) return 1; // future-dated (e.g. scheduled) → full weight
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

const WEIGHTS = {
  billStatus: { introduced: 1, committee: 2, in_chamber: 3, passed_chamber: 3, enacted: 4, dead: 0 },
  alertSeverity: { critical: 3, alert: 2, watch: 1, routine: 0.5 },
  actionRequiredMult: 1.5,
  campaignAction: 1,
  // enforcement-type news (always anti-pressure)
  enforcementKinds: new Set(["ag_enforcement", "bop_action", "fda_action", "dea_action", "city_ordinance"]),
  newsBaseIfNoScore: 1,
};

const cutoffIso = new Date(NOW - LOOKBACK_DAYS * MS_DAY).toISOString();

// ── Fetch (read-only) ────────────────────────────────────────────────
const [billsR, campsR, actionsR, newsR, alertsR, statesR] = await Promise.all([
  sb.from("bills").select("id, state, kratom_relevance, status, last_action_at, active"),
  sb.from("campaigns").select("id, state"),
  sb.from("campaign_actions").select("campaign_id, sent_at").gte("sent_at", cutoffIso),
  sb.from("news_items").select("state, published_at, policy_event_kind, policy_event_score, bill_id, kratom_topic").gte("published_at", cutoffIso),
  sb.from("policy_alerts").select("bill_id, severity, action_required, created_at, occurs_at").gte("created_at", cutoffIso),
  sb.from("states").select("abbr, kratom_status"),
]);
for (const [name, r] of [["bills", billsR], ["campaigns", campsR], ["campaign_actions", actionsR], ["news_items", newsR], ["policy_alerts", alertsR], ["states", statesR]]) {
  if (r.error) { console.error(`fetch ${name} failed: ${r.error.message}`); process.exit(1); }
}

const billMap = new Map(); // id -> {state, dir, status}
for (const b of billsR.data ?? []) {
  const dir = b.kratom_relevance === "anti" ? "against" : b.kratom_relevance === "pro" ? "for" : null;
  billMap.set(b.id, { state: b.state, dir, status: b.status });
}
const campState = new Map((campsR.data ?? []).map((c) => [c.id, c.state]));

// ── Accumulate per-state pressure ────────────────────────────────────
// per state: { for, against, forRecent, againstRecent, drivers:{...} }
const RECENT_DAYS = 30;
const recentCut = NOW - RECENT_DAYS * MS_DAY;
const acc = new Map();
function bump(state, side, w, ts, driver) {
  if (!state || w <= 0) return;
  if (!acc.has(state)) acc.set(state, { for: 0, against: 0, forRecent: 0, againstRecent: 0, drivers: {} });
  const a = acc.get(state);
  a[side] += w;
  if (ts && new Date(ts).getTime() >= recentCut) a[`${side}Recent`] += w;
  a.drivers[driver] = (a.drivers[driver] ?? 0) + w;
}

// 1) Bills — standing legislative pressure, by stage, decayed on last_action_at
for (const b of billsR.data ?? []) {
  const dir = b.kratom_relevance === "anti" ? "against" : b.kratom_relevance === "pro" ? "for" : null;
  if (!dir) continue;
  if (b.last_action_at && new Date(b.last_action_at).getTime() < NOW - LOOKBACK_DAYS * MS_DAY) continue;
  const stageW = WEIGHTS.billStatus[b.status] ?? 1;
  const w = stageW * decay(b.last_action_at);
  bump(b.state, dir, w, b.last_action_at, `bill:${b.status}`);
}

// 2) Campaign actions — advocate pressure (P_for), decayed on sent_at
for (const a of actionsR.data ?? []) {
  const state = campState.get(a.campaign_id);
  bump(state, "for", WEIGHTS.campaignAction * decay(a.sent_at), a.sent_at, "advocate_action");
}

// 3) News — enforcement kinds = against; state_bill inherits bill dir
for (const n of newsR.data ?? []) {
  const score = Number(n.policy_event_score) > 0 ? Number(n.policy_event_score) : WEIGHTS.newsBaseIfNoScore;
  let dir = null;
  if (WEIGHTS.enforcementKinds.has(n.policy_event_kind)) dir = "against";
  else if (n.policy_event_kind === "state_bill" && n.bill_id && billMap.get(n.bill_id)) dir = billMap.get(n.bill_id).dir;
  if (!dir) continue;
  bump(n.state, dir, score * decay(n.published_at), n.published_at, `news:${n.policy_event_kind}`);
}

// 4) Policy alerts — direction via linked bill, weight via severity
for (const al of alertsR.data ?? []) {
  const bill = al.bill_id ? billMap.get(al.bill_id) : null;
  if (!bill || !bill.dir) continue; // need a directional bill to attribute
  let w = (WEIGHTS.alertSeverity[al.severity] ?? 1) * decay(al.occurs_at ?? al.created_at);
  if (al.action_required) w *= WEIGHTS.actionRequiredMult;
  bump(bill.state, bill.dir, w, al.occurs_at ?? al.created_at, `alert:${al.severity}`);
}

// ── Report ───────────────────────────────────────────────────────────
const statusOf = new Map((statesR.data ?? []).map((s) => [s.abbr, s.kratom_status]));
const rows = [...acc.entries()].map(([state, a]) => {
  const gap = a.against - a.for;
  const prior = (a.against - a.againstRecent) - (a.for - a.forRecent);
  const recentGap = a.againstRecent - a.forRecent;
  return {
    state,
    status: statusOf.get(state) ?? "?",
    against: a.against,
    for: a.for,
    gap,
    recentGap,
    velocity: recentGap - (prior * (RECENT_DAYS / Math.max(1, LOOKBACK_DAYS - RECENT_DAYS))),
    topDriver: Object.entries(a.drivers).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "",
  };
});

const fmt = (n) => n.toFixed(1).padStart(7);
console.log(`\n=== PRESSURE INDEX (read-only proof) · lookback ${LOOKBACK_DAYS}d · half-life ${HALF_LIFE_DAYS}d · ${new Date(NOW).toISOString().slice(0, 10)} ===`);
console.log("Gap = against − for (positive = opposition applying net pressure). recentGap = last 30d only.\n");

console.log("── Top 15 by NET PRESSURE AGAINST (where the fight is hottest) ──");
console.log("state  status   against      for      gap   recent  topDriver");
for (const r of rows.sort((a, b) => b.gap - a.gap).slice(0, 15)) {
  console.log(`  ${r.state.padEnd(4)} ${r.status.padEnd(7)} ${fmt(r.against)} ${fmt(r.for)} ${fmt(r.gap)} ${fmt(r.recentGap)}  ${r.topDriver}`);
}

console.log("\n── Top 12 MOBILIZATION GAPS (high against, low advocate pressure — act here) ──");
const oppy = rows.filter((r) => r.against > 1).sort((a, b) => (b.against - b.for) - (a.against - a.for)).slice(0, 12);
for (const r of oppy) {
  const ratio = r.for > 0 ? (r.against / r.for).toFixed(1) + "×" : "∞ (0 advocate)";
  console.log(`  ${r.state.padEnd(4)} ${r.status.padEnd(7)} against ${fmt(r.against)} vs for ${fmt(r.for)}  →  ${ratio} under-defended`);
}

console.log(`\nStates with any pressure signal: ${rows.length}/52. (Weights hand-set — see WEIGHTS in source. Sanity-check before surfacing.)`);

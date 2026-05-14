/**
 * State-briefing self-improvement audit (Phase 3 D7 first slice).
 *
 * The daily cron blindly regenerates all 51 state briefings on a 24h
 * schedule. That catches staleness but misses two failure modes:
 *
 *   1. Critique-unresolved — D5's self-critique flagged substantive
 *      issues, but the revision attempt failed (rate-limit, schema-
 *      fragment stub, provider saturation). The briefing went live
 *      anyway with known-bad content. data_snapshot.critique.history
 *      captures this; nothing currently acts on it.
 *
 *   2. Data drift mid-day — daily regen runs ~03:00 UTC. If a new
 *      kratom bill lands at 09:00 UTC, the briefing is "current"
 *      (generated today) but already stale until tomorrow's regen.
 *
 * This script audits the active state_briefings rows against live
 * data, flags states meeting any failure mode, and optionally calls
 * generate-state-briefing.mjs for each flagged state. Targeted regen
 * is cheap (5s per state) and uses the same critique loop, so re-runs
 * can self-correct.
 *
 * Usage:
 *   node --env-file=.env.local scripts/audit-state-briefings.mjs
 *     # report only — list states + reasons + counts
 *   node --env-file=.env.local scripts/audit-state-briefings.mjs --auto-regen
 *     # plus: regenerate flagged states inline
 *   node --env-file=.env.local scripts/audit-state-briefings.mjs --json
 *     # machine-readable output (for /admin/intel-health page later)
 *
 * Thresholds (tunable via flags):
 *   --max-age-days N     (default 7)   — older than this = stale
 *   --drift-pct N        (default 30)  — count delta % triggering regen
 *   --min-body-chars N   (default 2000) — below this = low quality
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };

const AUTO_REGEN = flag("--auto-regen");
const JSON_OUT = flag("--json");
const MAX_AGE_DAYS = parseInt(arg("--max-age-days", "7"), 10) || 7;
const DRIFT_PCT = parseInt(arg("--drift-pct", "30"), 10) || 30;
const MIN_BODY_CHARS = parseInt(arg("--min-body-chars", "2000"), 10) || 2000;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const log = (msg) => { if (!JSON_OUT) console.log(msg); };

// =============================================================
// Live count loaders — mirror what generate-state-briefing.mjs does
// when it builds data_snapshot, so deltas are apples-to-apples.
// =============================================================
async function liveCountsFor(state) {
  const [legs, bills, news, bopSrc, campAct] = await Promise.all([
    sb.from("legislators").select("id", { count: "exact", head: true }).eq("state", state).eq("active", true),
    sb.from("bills").select("id", { count: "exact", head: true }).eq("state", state).eq("active", true),
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("state", state).eq("active", true),
    sb.from("bop_source_documents").select("id", { count: "exact", head: true }).eq("state", state),
    sb.from("campaigns").select("id", { count: "exact", head: true }).eq("state", state).eq("active", true),
  ]);
  return {
    legCount: legs.count ?? 0,
    billCount: bills.count ?? 0,
    newsCount: news.count ?? 0,
    bopSrcCount: bopSrc.count ?? 0,
    campActiveCount: campAct.count ?? 0,
  };
}

// =============================================================
// Per-row evaluation: was the briefing's last critique pass clean?
// data_snapshot.critique.history is the audit trail from D5.
// =============================================================
function critiqueState(snapshot) {
  const c = snapshot?.critique;
  if (!c || !c.enabled) return { run: false, unresolved: false, reason: null };
  const history = Array.isArray(c.history) ? c.history : [];
  if (history.length === 0) return { run: false, unresolved: false, reason: null };
  // Find any pass that flagged needs_revision but the revision didn't
  // actually land (rate-limit fail, length rejection, provider saturation).
  const stuckPass = history.find(h => h.needs_revision === true && h.revised === false);
  if (stuckPass) {
    const rejection = stuckPass.rejection_reason ?? "provider_or_quota";
    return { run: true, unresolved: true, reason: `critique flagged ${stuckPass.issues?.length ?? 0} issue(s), revision blocked (${rejection})` };
  }
  return { run: true, unresolved: false, reason: null };
}

// =============================================================
// Drift detection — percentage delta on the counter that changed most.
// We treat a 30% swing as "the briefing's data assumptions are off
// enough to merit regen." Configurable via --drift-pct.
//
// We deliberately compare ONLY uncapped counters. The generator caps
// its bill+news loads (.limit(30) and .limit(10)) to fit prompt
// budget, so data_snapshot.billCount and .newsCount saturate at those
// values and don't reflect real growth. Comparing them to uncapped
// live counts would surface false drift on every state.
// =============================================================
const DRIFT_FIELDS = ["legCount", "bopSrcCount", "campActiveCount"];
function maxDriftPct(snapshot, live) {
  if (!snapshot) return null;
  let max = 0;
  let driftKey = null;
  for (const k of DRIFT_FIELDS) {
    const a = Number(snapshot[k] ?? 0);
    const b = Number(live[k] ?? 0);
    if (a === 0 && b === 0) continue;
    const denom = Math.max(a, 1);
    const pct = Math.abs(b - a) / denom * 100;
    if (pct > max) { max = pct; driftKey = `${k}:${a}→${b}`; }
  }
  return { maxPct: max, key: driftKey };
}

// =============================================================
// Main
// =============================================================
log(`Auditing active state_briefings (max-age=${MAX_AGE_DAYS}d, drift>=${DRIFT_PCT}%, min-body=${MIN_BODY_CHARS} chars)…`);

const { data: rows, error } = await sb
  .from("state_briefings")
  .select("id, state, body_md, generated_at, generated_by_provider, data_snapshot")
  .eq("is_active", true)
  .order("state");
if (error) { console.error("Failed to load briefings:", error.message); process.exit(1); }
log(`Loaded ${rows.length} active briefings\n`);

const flagged = [];
const now = Date.now();
for (const row of rows) {
  const reasons = [];
  // Critique audit
  const crit = critiqueState(row.data_snapshot);
  if (crit.unresolved) reasons.push(crit.reason);
  // Age check
  const ageDays = row.generated_at ? (now - new Date(row.generated_at).getTime()) / (1000 * 60 * 60 * 24) : 999;
  if (ageDays > MAX_AGE_DAYS) reasons.push(`stale (${ageDays.toFixed(1)}d old)`);
  // Length floor
  const bodyLen = row.body_md?.length ?? 0;
  if (bodyLen < MIN_BODY_CHARS) reasons.push(`low quality (${bodyLen} chars < ${MIN_BODY_CHARS})`);
  // Data drift
  const live = await liveCountsFor(row.state);
  const drift = maxDriftPct(row.data_snapshot, live);
  if (drift && drift.maxPct >= DRIFT_PCT) reasons.push(`data drift ${drift.maxPct.toFixed(0)}% (${drift.key})`);

  if (reasons.length > 0) {
    flagged.push({
      state: row.state,
      generated_at: row.generated_at,
      body_len: bodyLen,
      provider: row.generated_by_provider,
      age_days: Number(ageDays.toFixed(1)),
      reasons,
      live_counts: live,
      snapshot_counts: {
        legCount: row.data_snapshot?.legCount,
        billCount: row.data_snapshot?.billCount,
        newsCount: row.data_snapshot?.newsCount,
        bopSrcCount: row.data_snapshot?.bopSrcCount,
        campActiveCount: row.data_snapshot?.campActiveCount,
      },
    });
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    audited: rows.length,
    flagged: flagged.length,
    thresholds: { MAX_AGE_DAYS, DRIFT_PCT, MIN_BODY_CHARS },
    rows: flagged,
  }, null, 2));
} else {
  if (flagged.length === 0) {
    log(`✓ All ${rows.length} briefings clean — no flagged states.`);
  } else {
    log(`${flagged.length}/${rows.length} state(s) flagged for regen:`);
    for (const f of flagged) {
      log(`  ${f.state} · ${f.body_len} chars · ${f.age_days}d old · via ${f.provider}`);
      for (const r of f.reasons) log(`    - ${r}`);
    }
  }
}

// =============================================================
// Optional: regenerate flagged states in sequence
// =============================================================
if (AUTO_REGEN && flagged.length > 0) {
  log(`\n🔄 Auto-regenerating ${flagged.length} flagged briefing(s)…`);
  let ok = 0, fail = 0;
  for (const f of flagged) {
    log(`\n  → regenerating ${f.state}`);
    const proc = spawnSync(process.execPath, [
      "--env-file=.env.local",
      "scripts/generate-state-briefing.mjs",
      "--state", f.state,
    ], { stdio: "inherit" });
    if (proc.status === 0) ok++; else fail++;
  }
  log(`\nRegen complete — ok=${ok} fail=${fail}/${flagged.length}`);
}

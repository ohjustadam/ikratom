/**
 * egress-budget.mjs — how much of the Supabase free-tier egress cap is left,
 * and whether a given class of work is still allowed to spend it.
 *
 * WHY THIS EXISTS (2026-09-08). Supabase's free plan does not bill for egress
 * overage — it RESTRICTS the project. The dashboard states it plainly: "Grace
 * period is over · Your projects will not be able to serve requests when you
 * use up your quota." Hitting the cap does not cost money, it takes the site
 * down, and it already happened once on 2026-07-16.
 *
 * The owner's requirement is that it must not be POSSIBLE for the site to go
 * down this way. Monitoring cannot deliver that: `check-egress-usage.mjs` has
 * been paging correctly for weeks and the number still climbed to 94%, because
 * an alert only works if a human is awake to act on it. What delivers it is a
 * gate that sheds load automatically.
 *
 * THE PRIORITY RULE, and it is the whole design: when the budget runs low, the
 * ROBOTS stop so the HUMANS can keep using the site. Cron jobs are deferrable —
 * news sync, enrichment and backfills can wait a day and lose nothing
 * permanent. A visitor hitting a dead site is the failure we are actually
 * trying to prevent. So background work is cut off well before the cap, and the
 * remaining headroom is reserved for page traffic.
 *
 * Tiers, by what they cost us to skip:
 *   bulk      backfills, wide audits, embeddings, re-scans. Skipped first.
 *   normal    routine enrichment and syncs. The bulk of the cron fleet.
 *   essential watchdogs, alerting, anything that would hide a failure if it
 *             stopped. Never gated — these are how we find out we are in
 *             trouble, and a monitor that silences itself under load is worse
 *             than no monitor.
 *
 * Reads one small row, so the gate itself is not a meaningful cost.
 */
import { createClient } from "@supabase/supabase-js";

import { readFileSync } from "node:fs";

export const BUDGET_GB = 5;

/**
 * The raw NIC counter over-counts billable egress by an amount that drifts with
 * traffic (replication + infra chatter is a bigger share when the site is
 * quiet). So the ratio is not a constant in code any more: it is measured
 * against the Supabase dashboard and kept in egress-calibration.json, shared by
 * this gate and check-egress-usage.mjs. 2026-10-07: at 0.497 the gate read
 * 74.5% while the dashboard read 55% and the brake had paused 32 daily jobs for
 * no reason. Recalibrate with scripts/egress-calibrate.mjs.
 */
export const CALIBRATION = JSON.parse(readFileSync(new URL("./egress-calibration.json", import.meta.url), "utf8"));
/**
 * Raw NIC counter -> billable. Re-calibrated 2026-09-10 from 0.54: at that
 * value the watchdog read 102.3% while the dashboard read 94.2%, i.e. it was
 * declaring a breach that had not happened. Keep this in step with
 * check-egress-usage.mjs — the gate below sheds real work based on it, so
 * reading high defers jobs for no reason and reading low would miss the wall.
 */
export const BILLABLE_RATIO = CALIBRATION.ratio;
export const EGRESS_CYCLE_ANCHOR_DAY = CALIBRATION.cycleAnchorDay;

/** Fraction of the cap at which each tier stops running. */
export const TIER_LIMITS = {
  // Raised 2026-10-07 once the reading matched the dashboard (it carries a 10%
  // over-report margin). A brake that trips at a phantom 70% pauses real work.
  bulk: 0.80,
  normal: 0.92,
  essential: Infinity,
};

/**
 * A tier past its line only sheds when the cycle is on track to end at or
 * above this share of the cap (2026-10-13). Before, crossing 80% paused bulk
 * jobs even with two days left and a burn rate that finished the cycle at
 * ~88% — throttling work that was never going to cause a breach. The owner's
 * rule is to throttle only when it is actually needed.
 */
export const PROJECTION_CEILING = 0.97;
/** Burn rate is measured over this many trailing hours of readings. */
const RATE_WINDOW_HOURS = 72;

/** Next billing-cycle start (when usage resets). */
export function nextCycleStart(now = new Date()) {
  const d = cycleStart(now);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** Current billing-cycle start (the most recent anchor day, UTC). */
export function cycleStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), EGRESS_CYCLE_ANCHOR_DAY));
  if (now < d) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
}

/**
 * Month-to-date billable egress, derived from the watchdog's counter history.
 *
 * `scraper_runs.rows_updated` for source `egress_watchdog` stores the RAW
 * cumulative transmit counter in MB — NOT month-to-date usage. Billable MTD is
 * the sum of deltas since the cycle anchor, times BILLABLE_RATIO. Getting that
 * distinction wrong reads ~5x high and is the single easiest mistake here.
 *
 * Reads EVERY reading of the cycle, paged (fixed 2026-10-13). It used to take
 * the oldest 200, and once the clock fix (#960) raised the watchdog to ~17
 * readings a day, a cycle passed 200 by day 12: the number froze, its age
 * crossed 48h, and the gate failed open — the brake was off for the last
 * third of every cycle, exactly when it matters.
 *
 * @returns {Promise<{pct:number|null, usedMb:number|null, readings:number, staleHours:number|null, mbPerDay:number|null, projectedPct:number|null}>}
 */
export async function getEgressStatus(sb = client(), now = new Date()) {
  const data = [];
  let error = null;
  for (let from = 0; from < 20_000; from += 1000) {
    const res = await sb
      .from("scraper_runs")
      .select("finished_at, rows_updated")
      .eq("source", "egress_watchdog")
      .gte("finished_at", cycleStart(now).toISOString())
      .order("finished_at", { ascending: true })
      .range(from, from + 999);
    if (res.error) { error = res.error; break; }
    data.push(...(res.data ?? []));
    if (!res.data || res.data.length < 1000) break;
  }
  const empty = { pct: null, usedMb: null, readings: 0, staleHours: null, mbPerDay: null, projectedPct: null };
  if (error || !data.length) return empty;

  // Only rows that actually CARRY a counter reading count, for both the usage
  // sum and the freshness check. check-egress-usage.mjs writes a row with
  // status "error" and no rows_updated when the metrics endpoint refuses it —
  // a run that happened but measured nothing.
  //
  // Deriving staleHours from every row instead (fixed 2026-09-17) made that
  // case invisible in the worst possible way: the freshness check read the
  // error row's timestamp and stayed green, while pct froze at whatever the
  // last real reading said. The gate then kept comparing a number that had
  // stopped moving against its ceiling, so it would never shed and never hit
  // the 48h fail-open path that exists precisely for a blind watchdog. A
  // stuck-but-plausible reading is worse than a missing one, because the
  // missing one is documented to fail open and this one just quietly lied.
  const withReading = data.filter((r) => Number(r.rows_updated ?? 0) > 0);
  const pts = withReading.map((r) => Number(r.rows_updated));
  if (pts.length < 2) return { ...empty, readings: pts.length };

  let usedMb = 0;
  for (let i = 1; i < pts.length; i++) {
    // A counter that went DOWN means the instance restarted; count the new
    // reading itself rather than a negative delta.
    usedMb += pts[i] >= pts[i - 1] ? pts[i] - pts[i - 1] : pts[i];
  }
  usedMb *= BILLABLE_RATIO;
  const last = withReading[withReading.length - 1]?.finished_at;
  const staleHours = last ? (now.getTime() - new Date(last).getTime()) / 3.6e6 : null;

  // Burn rate over the trailing window, then where the cycle is heading.
  let mbPerDay = null;
  let projectedPct = null;
  const windowStart = now.getTime() - RATE_WINDOW_HOURS * 3.6e6;
  const recent = withReading.filter((r) => new Date(r.finished_at).getTime() >= windowStart);
  if (recent.length >= 2) {
    const spanDays = (new Date(recent[recent.length - 1].finished_at) - new Date(recent[0].finished_at)) / 864e5;
    if (spanDays >= 0.25) {
      let windowMb = 0;
      for (let i = 1; i < recent.length; i++) {
        const a = Number(recent[i - 1].rows_updated), b = Number(recent[i].rows_updated);
        windowMb += b >= a ? b - a : b;
      }
      mbPerDay = (windowMb * BILLABLE_RATIO) / spanDays;
      const daysLeft = Math.max(0, (nextCycleStart(now).getTime() - now.getTime()) / 864e5);
      projectedPct = (usedMb + mbPerDay * daysLeft) / (BUDGET_GB * 1000);
    }
  }
  return { pct: usedMb / (BUDGET_GB * 1000), usedMb, readings: pts.length, staleHours, mbPerDay, projectedPct };
}

/**
 * Gate for a cron script. Call it FIRST, before any other query.
 *
 * Returns `{ skip, reason, pct }`. On `skip`, the caller should record a
 * `scraper_runs` row with status "skipped" and exit 0 — a job that stops for
 * budget must still say so, or the staleness watchdog reads the silence as a
 * failure and pages about a job that is working exactly as designed.
 *
 * FAILS OPEN, deliberately. If the status cannot be determined (no readings
 * yet, watchdog stale), work proceeds. A gate that blocks the whole fleet
 * because its own telemetry is missing would be a self-inflicted outage, and
 * the tier limits already leave headroom for a day of over-run.
 */
export async function checkEgressBudget(tier = "normal", sb = client(), now = new Date()) {
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.normal;
  if (!Number.isFinite(limit)) return { skip: false, reason: "essential tier is never gated", pct: null };

  const { pct, staleHours, projectedPct } = await getEgressStatus(sb, now);
  if (pct == null) return { skip: false, reason: "egress status unknown — failing open", pct: null };
  if (staleHours != null && staleHours > 48) {
    return { skip: false, reason: `egress reading ${staleHours.toFixed(0)}h stale — failing open`, pct };
  }
  // Past the tier line but on track to finish the cycle well under the cap:
  // keep working. Throttle only when the projection says it is needed.
  if (pct >= limit && projectedPct != null && projectedPct < PROJECTION_CEILING) {
    return {
      skip: false,
      pct,
      reason: `egress ${(pct * 100).toFixed(1)}%, past the ${(limit * 100).toFixed(0)}% ${tier} line but projected to end the cycle at ${(projectedPct * 100).toFixed(0)}% — not throttling`,
    };
  }
  if (pct >= limit) {
    return {
      skip: true,
      pct,
      reason: `egress at ${(pct * 100).toFixed(1)}% of the ${BUDGET_GB}GB cap, over the ${(limit * 100).toFixed(0)}% ceiling for "${tier}" work — deferring so page traffic keeps its headroom`,
    };
  }
  return { skip: false, reason: `egress ${(pct * 100).toFixed(1)}% — under the ${(limit * 100).toFixed(0)}% ${tier} ceiling`, pct };
}

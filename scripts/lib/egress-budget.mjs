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

export const BUDGET_GB = 5;
/**
 * Raw NIC counter -> billable. Re-calibrated 2026-09-10 from 0.54: at that
 * value the watchdog read 102.3% while the dashboard read 94.2%, i.e. it was
 * declaring a breach that had not happened. Keep this in step with
 * check-egress-usage.mjs — the gate below sheds real work based on it, so
 * reading high defers jobs for no reason and reading low would miss the wall.
 */
export const BILLABLE_RATIO = 0.497;
export const EGRESS_CYCLE_ANCHOR_DAY = 16;

/** Fraction of the cap at which each tier stops running. */
export const TIER_LIMITS = {
  bulk: 0.70,
  normal: 0.85,
  essential: Infinity,
};

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
 * @returns {Promise<{pct:number|null, usedMb:number|null, readings:number, staleHours:number|null}>}
 */
export async function getEgressStatus(sb = client()) {
  const { data, error } = await sb
    .from("scraper_runs")
    .select("finished_at, rows_updated")
    .eq("source", "egress_watchdog")
    .gte("finished_at", cycleStart().toISOString())
    .order("finished_at", { ascending: true })
    .limit(200);
  if (error || !data?.length) return { pct: null, usedMb: null, readings: 0, staleHours: null };

  const pts = data.map((r) => Number(r.rows_updated ?? 0)).filter((v) => v > 0);
  if (pts.length < 2) return { pct: null, usedMb: null, readings: pts.length, staleHours: null };

  let usedMb = 0;
  for (let i = 1; i < pts.length; i++) {
    // A counter that went DOWN means the instance restarted; count the new
    // reading itself rather than a negative delta.
    usedMb += pts[i] >= pts[i - 1] ? pts[i] - pts[i - 1] : pts[i];
  }
  usedMb *= BILLABLE_RATIO;
  const last = data[data.length - 1]?.finished_at;
  const staleHours = last ? (Date.now() - new Date(last).getTime()) / 3.6e6 : null;
  return { pct: usedMb / (BUDGET_GB * 1000), usedMb, readings: pts.length, staleHours };
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
export async function checkEgressBudget(tier = "normal", sb = client()) {
  const limit = TIER_LIMITS[tier] ?? TIER_LIMITS.normal;
  if (!Number.isFinite(limit)) return { skip: false, reason: "essential tier is never gated", pct: null };

  const { pct, staleHours } = await getEgressStatus(sb);
  if (pct == null) return { skip: false, reason: "egress status unknown — failing open", pct: null };
  if (staleHours != null && staleHours > 48) {
    return { skip: false, reason: `egress reading ${staleHours.toFixed(0)}h stale — failing open`, pct };
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

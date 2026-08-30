/**
 * netlify-credits.mjs — estimate Netlify credit burn for the CURRENT usage period.
 *
 * WHY THIS EXISTS (2026-07-30 outage):
 * The site went fully dark — `disabled: true`,
 * `disabled_reason: "Account usage exceeded for credits"` — and the watchdog
 * never warned, because it was watching meters that no longer decide anything:
 *
 *   1. Bandwidth against a 100 GB ceiling. Real usage was 0.77 GB (0.8%).
 *      Green all the way into the outage.
 *   2. `usages_exceeded`, which only becomes non-empty AT the moment the site
 *      is already disabled. That is a death certificate, not a warning.
 *
 * Netlify's free tier is now `credit-free`: ONE pooled budget (300 credits) that
 * every meter draws from. Bandwidth is no longer a ceiling, it's an input priced
 * at 20 credits/GB. So the only number worth alerting on is credits.
 *
 * Published rates (netlify.com/pricing, read 2026-07-30):
 *   production deploy  15 credits each
 *   bandwidth          20 credits / GB
 *   web requests        2 credits / 10k
 *   compute           10 credits / GB-hour
 *
 * ── IMPORTANT: this is a FLOOR, not a total ──────────────────────────────────
 * Netlify exposes deploys and bandwidth to a free-tier token, but NOT request
 * counts or compute GB-hours. So we can only measure two of the four meters.
 * The estimate is therefore a deliberate UNDER-count, and every consumer must
 * treat it as "at least this much". That is the safe direction for a brake:
 * we trip early, never late. Thresholds are set low to absorb the blind meters.
 *
 * The 2026-07 burn showed why the floor is still worth a lot: 15 production
 * deploys x 15 = 225 credits, i.e. 75% of the entire monthly budget went to
 * SHIPPING, which is the one input we fully control.
 */

/** Published Netlify credit rates. */
export const RATES = {
  perProductionDeploy: 15,
  perGbBandwidth: 20,
  per10kRequests: 2,
  perGbHourCompute: 10,
};

const API = "https://api.netlify.com/api/v1";

async function nf(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`netlify ${path} -> ${res.status}`);
  return res.json();
}

/**
 * Count production deploys that actually shipped since `since`.
 *
 * Only `state === "ready"` production-context deploys are counted as billable
 * builds. Failed builds are excluded from the 15-credit line (they still burn
 * build compute, which is one of the meters we cannot read — another reason
 * this figure is a floor).
 */
async function countProductionDeploys(siteId, token, since) {
  let page = 1;
  let count = 0;
  let scanned = 0;
  // Cap the walk: 5 pages x 100 is far more than a sane month, and an unbounded
  // loop in a cron job is how a watchdog becomes the outage.
  while (page <= 5) {
    const batch = await nf(`/sites/${siteId}/deploys?per_page=100&page=${page}`, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    scanned += batch.length;
    let allOlder = true;
    for (const d of batch) {
      const created = new Date(d.created_at);
      if (created >= since) {
        allOlder = false;
        if (d.context === "production" && d.state === "ready") count += 1;
      }
    }
    // Deploys come newest-first; once a whole page predates the period we're done.
    if (allOlder) break;
    if (batch.length < 100) break;
    page += 1;
  }
  return { count, scanned };
}

/**
 * Estimate credit usage for the current period.
 *
 * @returns {Promise<{
 *   ok: boolean, reason?: string,
 *   planCredits: number, usedFloor: number, pct: number,
 *   deploys: number, deployCredits: number,
 *   bandwidthGb: number, bandwidthCredits: number,
 *   periodStart: string, periodEnd: string,
 *   projectedUsed: number, blindCredits: number, floorPct: number,
 *   exceeded: boolean, exceededAt: string|null,
 *   graceTopupAt: string|null, isFloor: true,
 * }>}
 */
export async function estimateNetlifyCredits({ token, accountSlug, siteId }) {
  if (!token) return { ok: false, reason: "NETLIFY_AUTH_TOKEN not set" };

  const acct = await nf(`/accounts/${accountSlug}`, token);
  const planCredits = Number(acct.plan_credits) || 300;
  const periodStart = new Date(acct.current_usage_period_start);
  const periodEnd = acct.next_usage_period_start ?? null;

  // Netlify's own authoritative "you are over" list. Non-empty means the site
  // is ALREADY disabled — we surface it, but it is not what we alert on.
  const exceededList = Array.isArray(acct.usages_exceeded) ? acct.usages_exceeded : [];
  const creditRow = exceededList.find((e) => e?.usage_type === "credits");

  let bandwidthGb = 0;
  try {
    const bw = await nf(`/accounts/${accountSlug}/bandwidth`, token);
    bandwidthGb = (Number(bw.used) || 0) / 1e9;
  } catch {
    // Bandwidth is one input of several; losing it must not blind the whole check.
  }

  let deploys = 0;
  if (siteId) {
    try {
      ({ count: deploys } = await countProductionDeploys(siteId, token, periodStart));
    } catch {
      // Same reasoning as bandwidth — degrade, don't crash.
    }
  }

  const deployCredits = deploys * RATES.perProductionDeploy;
  const bandwidthCredits = bandwidthGb * RATES.perGbBandwidth;
  const usedFloor = deployCredits + bandwidthCredits;
  const floorPct = planCredits > 0 ? (usedFloor / planCredits) * 100 : 0;

  // Project the two blind meters (requests + compute) from the calibration
  // below, and report THAT as the number to act on. See MEASURED_FLOOR_SHARE.
  const projectedUsed = usedFloor / MEASURED_FLOOR_SHARE;
  const pct = planCredits > 0 ? (projectedUsed / planCredits) * 100 : 0;

  return {
    ok: true,
    planCredits,
    usedFloor,
    floorPct,
    projectedUsed,
    pct,
    blindCredits: projectedUsed - usedFloor,
    floorShare: MEASURED_FLOOR_SHARE,
    deploys,
    deployCredits,
    bandwidthGb,
    bandwidthCredits,
    periodStart: acct.current_usage_period_start,
    periodEnd,
    exceeded: Boolean(creditRow),
    exceededAt: creditRow?.exceeded_at ?? null,
    graceTopupAt: acct.grace_topup_granted_at ?? null,
    isFloor: true,
  };
}

/**
 * ── CALIBRATION ──────────────────────────────────────────────────────────────
 * What fraction of the REAL burn the measurable floor represents.
 *
 * Measured 2026-08-30, and this is why the old model was dangerous. Netlify's
 * own alert (account `credit_alert_percentage: 75`) fired, i.e. real usage had
 * crossed 225 of 300 credits. At that same moment this estimator measured:
 *
 *     5 deploys x 15 = 75  +  1.12 GB x 20 = 22   ->  97 credits, "32%"
 *
 * So the floor was 97/225 = 0.43 of reality, and requests + compute were 57% of
 * the burn — NOT "roughly a fifth" as the previous note assumed. Under that
 * assumption the brake sat at 90% OF THE FLOOR, which would have needed ~17 more
 * production deploys to trip. It could not have fired before the account was
 * disabled, which is the exact failure shape of the 2026-07-30 outage: a
 * watchdog pointed at meters that no longer decide anything.
 *
 * RE-CALIBRATE whenever Netlify's alert fires again: set this to
 * (floor at that moment) / (alert percentage x planCredits / 100).
 * Lower = more conservative. Never raise it without a fresh measurement.
 */
export const MEASURED_FLOOR_SHARE = 0.43;

/**
 * Threshold ladder, applied to the PROJECTED total (not the floor). With the
 * calibration above, a floor of 97 projects to 225 = 75% = "critical", which is
 * what the account actually was on 2026-08-30.
 */
export const CREDIT_THRESHOLDS = { notice: 50, warn: 65, critical: 75, brake: 85 };

export function creditSeverity(pct) {
  if (pct >= CREDIT_THRESHOLDS.brake) return "brake";
  if (pct >= CREDIT_THRESHOLDS.critical) return "critical";
  if (pct >= CREDIT_THRESHOLDS.warn) return "warn";
  if (pct >= CREDIT_THRESHOLDS.notice) return "notice";
  return "ok";
}

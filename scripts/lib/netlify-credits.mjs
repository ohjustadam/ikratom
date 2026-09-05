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
 *   passiveUsed: number, burnPerDay: number, daysElapsed: number,
 *   daysRemaining: number|null, daysToCap: number,
 *   projectedAtReset: number|null, willExceedBeforeReset: boolean,
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
  // Deploys are exact; only the traffic-driven meters get estimated.
  const blindCredits = bandwidthCredits * BLIND_PER_BANDWIDTH_CREDIT;
  const projectedUsed = deployCredits + bandwidthCredits + blindCredits;
  const pct = planCredits > 0 ? (projectedUsed / planCredits) * 100 : 0;

  // ── RUNWAY ────────────────────────────────────────────────────────────────
  // A percentage tells you where you ARE; it does not tell you whether you will
  // MAKE IT. On 2026-09-01 the account sat at 90% with zero deploys since
  // 08-30 — bandwidth alone was adding ~3.9 projected credits/day, which put
  // the cap at ~09-09, ten days before the 09-19 reset. The level looked
  // survivable; the trajectory was not. Netlify disables the entire site at
  // 100% (2026-07-30), so the trajectory is the number that matters.
  //
  // Rate is the whole-period average, so it INCLUDES deploy spikes and there-
  // fore overstates the idle rate. That is the safe direction: it warns early.
  const nowMs = Date.now();
  const daysElapsed = Math.max((nowMs - periodStart.getTime()) / 86_400_000, 0.5);
  const daysRemaining = periodEnd
    ? Math.max((new Date(periodEnd).getTime() - nowMs) / 86_400_000, 0)
    : null;
  // Passive burn EXCLUDES deploys: a deploy is a decision, not a leak, and
  // averaging six of them into the rate is what produced the 5x-hot alarm.
  const passiveUsed = bandwidthCredits + blindCredits;
  const burnPerDay = passiveUsed / daysElapsed;
  const daysToCap = burnPerDay > 0 ? (planCredits - projectedUsed) / burnPerDay : Infinity;
  const projectedAtReset = daysRemaining === null ? null : projectedUsed + burnPerDay * daysRemaining;
  // The one boolean worth alerting on: will we run out BEFORE the reset?
  const willExceedBeforeReset = daysRemaining !== null && daysToCap < daysRemaining;

  return {
    ok: true,
    planCredits,
    usedFloor,
    floorPct,
    projectedUsed,
    burnPerDay,
    passiveUsed,
    daysElapsed,
    daysRemaining,
    daysToCap,
    projectedAtReset,
    willExceedBeforeReset,
    pct,
    blindCredits,
    floorShare: MEASURED_FLOOR_SHARE,
    calibration: latestCalibration(),
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
 * ── CALIBRATION LOG ─────────────────────────────────────────────────────────
 * Requests and compute are the two meters Netlify does NOT expose to the API,
 * on any plan — verified again on the Personal plan 2026-09-04, where
 * /sites/:id/usage still returns credit_usage 0 and there is no per-meter
 * endpoint. They are only readable by eye at:
 *
 *     app.netlify.com -> Usage & billing -> Account usage insights
 *
 * So this stays a MODEL. What changed on 2026-09-04 is that it is now anchored
 * to real readings instead of one inferred point. Each entry is a full billing
 * period transcribed from that page. Deploys and bandwidth are exact; `blind`
 * is (compute + requests) in credits, and the ratio scales it from bandwidth
 * because all three track traffic.
 *
 * ADD A ROW after any month where you read the dashboard. The newest row wins,
 * and `calibrationAgeDays` in the estimate warns when the anchor is stale —
 * which matters most right now, because the 2026-09-04 static-rendering fix is
 * expected to cut compute hard while bandwidth holds. Until a post-fix month is
 * recorded here, this model OVER-estimates (it trips early, never late).
 */
export const CALIBRATION = [
  {
    period: "2026-07-05..2026-08-04",
    total: 331, deployCredits: 225, bandwidthCredits: 14.7,
    // 7.3 GB-Hrs compute = 73 · 50K requests = 10
    blind: 83,
    note: "pre-fix; 15 deploys dominated",
  },
  {
    period: "2026-08-05..2026-09-04",
    total: 332, deployCredits: 105, bandwidthCredits: 28,
    // 18 GB-Hrs compute = 180 · 100K requests = 20. Compute alone was 54% of
    // the month and DOUBLED from July. This is the period that capped the free
    // plan on 2026-09-02 and took the site down.
    blind: 200,
    note: "pre-fix; compute-dominated, cap hit",
  },
];

/** Most recent real reading, and how stale it is. */
export function latestCalibration(now = new Date()) {
  const c = CALIBRATION[CALIBRATION.length - 1];
  const end = new Date(`${c.period.split("..")[1]}T00:00:00Z`);
  return { ...c, ageDays: Math.max(0, Math.round((now - end) / 86400000)) };
}

/**
 * Blind credits (requests + compute) per credit of BANDWIDTH, derived from the
 * newest calibration row rather than hardcoded.
 *
 * Deploys are deliberately NOT scaled by this: they are exact (15 each, counted
 * from the API) and they are not traffic. An earlier version inflated them too,
 * which produced a burn rate of 19.8 credits/day against a real ~11.5 and a
 * "cap in 1.5 days" alarm that was 5x too aggressive.
 *
 * Observed history: 83/14.7 = 5.6 (Jul) -> 200/28 = 7.1 (Aug).
 */
export const BLIND_PER_BANDWIDTH_CREDIT =
  CALIBRATION[CALIBRATION.length - 1].blind / CALIBRATION[CALIBRATION.length - 1].bandwidthCredits;

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

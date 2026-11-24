// crawl-brake.mjs — when should the staged crawl lift stop, and may it be raised?
//
// Pure functions, so the thresholds are tested (tests/crawl-brake.test.ts)
// instead of living inside a cron script nobody runs by hand.
//
// WHY (2026-11-24). robots.txt is lifted in stages (src/lib/crawl-policy.ts).
// Googlebot and Bingbot are Cloudflare "verified bots": they skip the crawl
// shield AND the per-IP rate limit (both say `not cf.client.bot`), so after a
// lift nothing at the edge slows them, and Google caches robots.txt for about a
// day. The only things that can stop a lift that is costing too much are this
// brake (lowers `site_config.crawl_stage` to 0 within the hour) and the
// Cloudflare lever in private/scripts/cf-bot-brake.mjs (immediate).
//
// The input is readTrueCredits() from scripts/lib/netlify-credits.mjs:
//   { ok, total, used, daily: [{ date, total, passive }] }  (daily is oldest first,
//   the last entry is today and partial; `passive` excludes production deploys).

/** Percent of the monthly credits used at which the lift is stopped. */
export const BRAKE_PCT = 90;
/** Percent above which a human is refused when raising the stage (override: --force). */
export const LIFT_BLOCK_PCT = 80;
/** A day of passive burn this many times the recent median is a spike. */
export const SPIKE_MULT = 2.5;
/** Below this many credits a "spike" is just a busy day. */
export const SPIKE_FLOOR = 40;

const pct = (truth) => (truth.total ? (100 * truth.used) / truth.total : 0);

/** Median of the 14 complete days before the last two (the same window the credit gate uses). */
export function medianPassive(daily) {
  const prior = (daily ?? []).slice(-16, -2).map((d) => d.passive).sort((a, b) => a - b);
  return prior.length ? prior[Math.floor(prior.length / 2)] : 0;
}

/**
 * @param {{ stage: number, truth: any }} a
 * @returns {{ brake: boolean, blind: boolean, reasons: string[], note: string, pct?: number }}
 */
export function evaluateBrake({ stage, truth }) {
  if (!stage) return { brake: false, blind: false, reasons: [], note: "stage 0: nothing is open, nothing to brake" };
  if (!truth?.ok) return { brake: false, blind: true, reasons: [], note: `BLIND: ${truth?.reason ?? "no credit reading"}` };

  const used = pct(truth);
  const reasons = [];
  if (used >= BRAKE_PCT) reasons.push(`credits at ${used.toFixed(0)}% of ${truth.total} (the brake is ${BRAKE_PCT}%)`);

  const med = medianPassive(truth.daily);
  const limit = Math.max(SPIKE_FLOOR, SPIKE_MULT * med);
  const worst = (truth.daily ?? []).slice(-2).reduce((m, d) => (d.passive > m.passive ? d : m), { passive: 0, date: null });
  if (worst.passive > limit) {
    reasons.push(`${worst.date}: ${worst.passive.toFixed(0)} credits of passive burn against a ${med.toFixed(0)} median (limit ${limit.toFixed(0)})`);
  }

  const note = reasons.length
    ? `BRAKE: ${reasons.join("; ")}`
    : `ok at stage ${stage}: ${used.toFixed(0)}% used, worst recent day ${worst.passive.toFixed(0)} vs limit ${limit.toFixed(0)}`;
  return { brake: reasons.length > 0, blind: false, reasons, note, pct: used };
}

/**
 * May a human raise the stage right now? Lowering is always allowed.
 * @param {{ truth: any, force?: boolean }} a
 */
export function liftAllowed({ truth, force = false }) {
  if (force) return { ok: true, reason: "forced" };
  if (!truth?.ok) return { ok: false, reason: `cannot read the credit meter (${truth?.reason ?? "no reading"}); pass --force to raise it blind` };
  const used = pct(truth);
  if (used >= LIFT_BLOCK_PCT) {
    return { ok: false, reason: `credits are at ${used.toFixed(0)}% of ${truth.total}; wait for the reset or pass --force` };
  }
  return { ok: true, reason: `credits at ${used.toFixed(0)}%` };
}

/**
 * review-dates.mjs — shared logic for the "review-by" failsafe.
 *
 * The deadline recorded up front on every scraped bill, and the if/then rules
 * the review cron applies when it lapses. Keeping it pure + shared so the sync
 * (which stamps review_by) and the review engine (which acts on it) agree.
 */

/** Statuses meaning the bill BECAME LAW → keep it active for repeal tracking
 *  even after its session ends. Everything else dies when the session closes. */
export const LAW_KEEP_STATUSES = new Set(["enacted"]);

/** Pull 4-digit years out of a session label ("2019-2020", "2023", "2017 Regular Session"). */
export function sessionYears(sessionId) {
  const m = String(sessionId ?? "").match(/(?:19|20)\d{2}/g);
  return m ? m.map(Number) : [];
}

/**
 * review_by = end of the session's final year (23:59 Dec 31). Conservative
 * fallback — by the time it lapses the session is unambiguously over; the
 * LegiScan sine_die flag retires bills EARLIER (spring adjournment) when known.
 * Returns an ISO string, or null when the session label is missing/garbage.
 */
export function computeBillReviewBy(sessionId) {
  const ys = sessionYears(sessionId);
  if (!ys.length) return null;
  const end = Math.max(...ys);
  if (end < 1990 || end > 2100) return null;
  return `${end}-12-31T23:59:59.000Z`;
}

/**
 * The if/then. Given a bill + whether its session has adjourned sine die + now,
 * decide whether to retire it. Retire when the session is over (sine_die, or the
 * review_by deadline has lapsed) AND it never became law AND nothing happened in
 * the last `graceDays` (so a bill mid-action or a just-carried-over one isn't
 * wrongly buried — the revolving-bill guard).
 */
export function shouldRetire(bill, { sineDie, now = Date.now(), graceDays = 21 }) {
  const status = (bill.status ?? "").toLowerCase();
  if (LAW_KEEP_STATUSES.has(status)) return false;
  const reviewBy = bill.review_by ? new Date(bill.review_by).getTime() : null;
  const sessionOver = sineDie || (reviewBy != null && reviewBy < now);
  if (!sessionOver) return false;
  const lastAction = bill.last_action_at ? new Date(bill.last_action_at).getTime() : null;
  if (lastAction != null && now - lastAction < graceDays * 86_400_000) return false;
  return true;
}

/**
 * Revival guard: a bill we retired should come back if its session is genuinely
 * current (review_by in the future, not sine_die) and it has a recent action —
 * catches a wrongly-buried revolving/carried-over bill.
 */
export function shouldRevive(bill, { sineDie, now = Date.now(), freshDays = 30 }) {
  if (sineDie) return false;
  const reviewBy = bill.review_by ? new Date(bill.review_by).getTime() : null;
  if (reviewBy == null || reviewBy < now) return false; // session still over → stay retired
  const lastAction = bill.last_action_at ? new Date(bill.last_action_at).getTime() : null;
  return lastAction != null && now - lastAction < freshDays * 86_400_000;
}

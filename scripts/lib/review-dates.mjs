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
 * Which legislative_sessions row a bill belongs to. session_id is not one
 * format: LegiScan rows carry LegiScan's numeric session id ("2161"), and
 * OpenStates rows a year label ("2025-2026") or a General Assembly number
 * ("114"). Reading years out of it matched only the middle kind, so on
 * 2026-11-03 about 130 bills from adjourned sessions still counted as live
 * (TN SB 1656 was an "imminent" ban six months after its companion became
 * law). Match the LegiScan id first, then a year in the label, then the year
 * of the last action. A regular session wins over a special one.
 */
export function matchSession(bill, rows) {
  if (!rows?.length) return null;
  const sid = String(bill.session_id ?? "").trim();
  const byId = sid ? rows.find((r) => r.legiscan_session_id != null && String(r.legiscan_session_id) === sid) : null;
  if (byId) return byId;
  const ys = sessionYears(sid);
  const year = ys.length ? Math.max(...ys)
    : bill.last_action_at ? new Date(bill.last_action_at).getUTCFullYear() : null;
  if (!year) return null;
  const spans = rows.filter((r) => (r.year_start ?? 0) <= year && year <= (r.year_end ?? 0));
  return spans.find((r) => !r.special) ?? spans[0] ?? null;
}

/** review_by from the matched session's last year, else from the label. */
export function sessionReviewBy(bill, row) {
  if (row?.year_end) return `${row.year_end}-12-31T23:59:59.000Z`;
  return computeBillReviewBy(bill.session_id);
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
 * catches a wrongly-buried revolving/carried-over bill. An action dated after
 * the day we retired it (`retiredOn`, YYYY-MM-DD) brings a live bill back
 * whatever the session flag says: LegiScan marks Illinois's General Assembly
 * adjourned, yet it can still pass bills in its veto and lame-duck sessions.
 * @param {{ status?: string, review_by?: string, last_action_at?: string }} bill
 * @param {{ sineDie: boolean, now?: number, freshDays?: number, retiredOn?: string | null }} opts
 */
export function shouldRevive(bill, { sineDie, now = Date.now(), freshDays = 30, retiredOn = null }) {
  const lastAction = bill.last_action_at ? new Date(bill.last_action_at).getTime() : null;
  const finished = ["dead", "vetoed", "failed"].includes((bill.status ?? "").toLowerCase());
  if (retiredOn && lastAction != null && !finished && lastAction > Date.parse(retiredOn)) return true;
  if (sineDie) return false;
  const reviewBy = bill.review_by ? new Date(bill.review_by).getTime() : null;
  if (reviewBy == null || reviewBy < now) return false; // session still over → stay retired
  return lastAction != null && now - lastAction < freshDays * 86_400_000;
}

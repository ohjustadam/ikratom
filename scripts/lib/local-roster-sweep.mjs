/**
 * local-roster-sweep.mjs — when to re-read every local roster after an election.
 *
 * Most local officials have no term end on file (4,810 of 5,293 on 2026-11-06),
 * so the "term ended" rule can't see who a November election replaced, and the
 * 150-day staleness rule could leave a new council unread until spring. County
 * and city terms mostly change hands around New Year, so the quarter after an
 * even-year general re-reads anything last checked before the new terms began.
 */

const SWEEP_MAX = 16; // per run: about 600 localities clears in under 40 days

/**
 * @param {number} now  epoch ms
 * @returns {{since:number, max:number} | null}  rosters older than `since` are due; null outside the window
 */
export function postElectionSweep(now) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const since = Date.UTC(year, 0, 2);
  if (year % 2 === 0 || now < since || d.getUTCMonth() > 2) return null;
  return { since, max: SWEEP_MAX };
}

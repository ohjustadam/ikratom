/**
 * Who gets the email digest daily, and who only on Mondays.
 *
 * WHY (PJ, 2026-11-24; owner yes "take your picks"): members who stopped
 * visiting kept getting a daily email they never open. That spends the free
 * daily send quota (Resend 100/day) on people who don't read it, and teaches
 * inboxes to file us as noise. So a member who has not been on iKratom for
 * QUIET_DAYS gets the digest once a week, on Mondays, until they come back.
 *
 * - Coming back is automatic: one signed-in visit stamps profiles.last_seen_at
 *   (and a sign-in stamps auth last_sign_in_at), and the next digest is daily.
 * - THE EXCEPTION: a member who picked "Daily" by hand keeps it, however quiet.
 *   The default is "instant", so "daily" is always a deliberate choice.
 * - Only the digest email slows down. Hearing alerts (--mode meetings),
 *   announcements, push and in-app notices are untouched.
 */

export const QUIET_DAYS = 30;

/**
 * THE SWITCH for the one-click "switch to weekly / back to daily" links in the
 * digest. They point at /api/email/cadence, which ships with the 12-05
 * production build. OFF until then, so no email links to a page that is not
 * live yet. The trunk flips this to true in the same merge window as that
 * build, next to GROUPS_IN_DIGEST.
 */
export const CADENCE_LINKS_LIVE = false;

const DAY = 864e5;
const t = (iso) => (iso ? Date.parse(iso) : NaN);

/**
 * True when the member has shown no sign of life for QUIET_DAYS. The newest of
 * a signed-in visit and a sign-in counts; with neither, the account's age does,
 * so a new member is never quiet in their first month.
 * @param {{ lastSeenAt?: string | null, lastSignInAt?: string | null, createdAt?: string | null }} m
 * @param {number} [now]
 */
export function isQuiet({ lastSeenAt, lastSignInAt, createdAt }, now = Date.now()) {
  const seen = [t(lastSeenAt), t(lastSignInAt)].filter(Number.isFinite);
  const ref = seen.length ? Math.max(...seen) : t(createdAt);
  if (!Number.isFinite(ref)) return false; // nothing to go on: keep today's behaviour
  return now - ref > QUIET_DAYS * DAY;
}

/**
 * The cadence the digest actually uses for one member: "daily", "weekly", or
 * "quiet" (weekly because they went quiet, not because they chose it).
 * @param {{ digest?: string | null, lastSeenAt?: string | null, lastSignInAt?: string | null, createdAt?: string | null }} member
 * @param {number} [now]
 * @returns {"daily" | "weekly" | "quiet"}
 */
export function digestCadence(member, now = Date.now()) {
  const d = member.digest ?? "instant";
  if (d === "weekly") return "weekly";
  if (d === "daily") return "daily"; // a hand-picked Daily is the exception
  return isQuiet(member, now) ? "quiet" : "daily";
}

/**
 * The start of a weekly member's window: a week back, but never before their
 * own last digest, so someone who had a daily email on Sunday does not get the
 * same stories again on Monday.
 * @param {string} weekAgoIso
 * @param {string | null | undefined} lastSentIso
 */
export function weeklySince(weekAgoIso, lastSentIso) {
  return lastSentIso && t(lastSentIso) > t(weekAgoIso) ? lastSentIso : weekAgoIso;
}

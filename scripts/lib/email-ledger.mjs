/**
 * email-ledger.mjs — who already got which member email, so a run that hits
 * the day's quota never sends the same email twice and never starves the
 * same members (2026-11-18 scale audit, migration 0326).
 *
 * Before this, scripts/send-email-notifications.mjs had two cracks that only
 * open past ~350 emails a day:
 *  - it read members with .limit(50_000), but PostgREST returns at most 1,000
 *    rows, so member #1,001 and later were never emailed;
 *  - a run that ran out of quota recorded "partial" and kept the old
 *    watermark, so the next meetings run re-sent the same alert to the members
 *    who already had it, and the digest always served the same first ~350.
 * The ledger (`email_deliveries`, one row per source + ref + member) fixes both
 * the re-sends and the order. Rows older than KEEP_DAYS are pruned each run.
 */

export const KEEP_DAYS = 45;

/** Every row of a query, 1,000 at a time. The query MUST be ordered (an unordered .range() overlaps). */
export async function fetchAll(makeQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

/** The digest's ledger ref: the member's civic day, Eastern time. */
export function digestRef(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** user_id -> latest sent_at (ISO) from ledger rows. */
export function lastSentByUser(rows) {
  const m = new Map();
  for (const r of rows ?? []) if (!m.has(r.user_id) || r.sent_at > m.get(r.user_id)) m.set(r.user_id, r.sent_at);
  return m;
}

/** "ref:user_id" keys for a fast "already delivered?" check. */
export function deliveredKeys(rows) {
  return new Set((rows ?? []).map((r) => `${r.ref}:${r.user_id}`));
}

/**
 * Where a member's digest starts: after their own last digest when we know it
 * (a member skipped yesterday for quota gets two days), never before `floor`.
 */
export function digestSinceFor(globalSince, floor, lastSent) {
  const s = lastSent && lastSent > globalSince ? lastSent : globalSince;
  return s < floor ? floor : s;
}

/**
 * Send order when the day's quota is tight: emails with a hearing first, then
 * the members emailed longest ago (never-emailed first), so the tail rotates.
 */
export function byPriority(lastSent) {
  const hearing = (j) => Number(/hearing/i.test(j.msg.subject));
  const seen = (j) => lastSent.get(j.user.id) ?? "";
  return (a, b) => hearing(b) - hearing(a) || (seen(a) < seen(b) ? -1 : seen(a) > seen(b) ? 1 : 0);
}

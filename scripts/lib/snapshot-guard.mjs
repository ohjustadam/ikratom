/**
 * snapshot-guard.mjs — decide whether an encrypted database snapshot is
 * trustworthy, without holding the private key.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES INSIDE db-snapshot-api.mjs:
 * it is the only thing standing between "the backup ran" and "the backup is
 * real", and a guard that cannot be tested is a guard nobody has ever seen go
 * red. Keeping the decision pure means every branch — missing accounts, an
 * empty capture, a damaged seal — is reachable from a test without a database,
 * a key, or a network call. See tests/backup-crypto.test.ts.
 *
 * WHAT IT DOES NOT DO, deliberately: it never decrypts. The backup private key
 * is not a GitHub secret and must never become one, because the whole point of
 * sealing with a public key is that the cloud cannot read the accounts it is
 * backing up. So every check here works off counts taken from the plaintext as
 * it streamed past, plus a header-only inspection of the sealed file.
 */

/**
 * Tables whose loss is unrecoverable.
 *
 * Everything else in a snapshot could in principle be re-scraped, re-derived or
 * re-entered by hand. Nothing re-derives an account: if `auth.users` or
 * `public.profiles` came back empty, the file may still be a perfectly valid
 * archive of configuration rows, and restoring from it would hand back a
 * platform with no members.
 */
export const MUST_HAVE_TABLES = ["auth.users", "public.profiles"];

/** Floor for total rows. Catches "captured essentially nothing" without being brittle. */
export const DEFAULT_MIN_ROWS = 100;

/**
 * @param {object} input
 * @param {Record<string, number>} input.counts    rows captured, keyed by qualified table name
 * @param {{ ok: boolean, reason?: string }} input.sealed  result of backup-crypto's inspect()
 * @param {number} [input.minRows]
 * @param {string[]} [input.mustHave]
 * @returns {{ ok: boolean, problems: string[], rowsTotal: number, critical: string }}
 */
export function assessSnapshot({ counts, sealed, minRows = DEFAULT_MIN_ROWS, mustHave = MUST_HAVE_TABLES }) {
  const safeCounts = counts ?? {};
  const rowsTotal = Object.values(safeCounts).reduce((a, b) => a + (Number(b) || 0), 0);
  const problems = [];

  for (const t of mustHave) {
    // `> 0` rather than a truthiness check: a missing table and a table that
    // returned zero rows are the same failure, and both must be caught.
    if (!(safeCounts[t] > 0)) problems.push(`${t} captured ${safeCounts[t] ?? 0} rows`);
  }

  if (rowsTotal < minRows) problems.push(`captured ${rowsTotal} rows total, floor is ${minRows}`);

  // A sealed file that cannot be identified from its header is not a backup,
  // however many rows went into it.
  if (!sealed?.ok) problems.push(`sealed file failed inspection: ${sealed?.reason ?? "no inspection result"}`);

  return {
    ok: problems.length === 0,
    problems,
    rowsTotal,
    critical: mustHave.map((t) => `${t}=${safeCounts[t] ?? 0}`).join(" "),
  };
}

/** Parse the `table=count` strings db-snapshot-api.mjs accumulates while streaming. */
export function countsFromStats(stats) {
  return Object.fromEntries((stats ?? []).map((s) => {
    const i = String(s).lastIndexOf("=");
    // lastIndexOf, not split("="): a table name containing "=" would otherwise
    // silently truncate rather than fail.
    return i < 0 ? [String(s), 0] : [String(s).slice(0, i), Number(String(s).slice(i + 1)) || 0];
  }));
}

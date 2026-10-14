/**
 * Pure helpers for the per-official kratom vote tally (State HQ officials list).
 * No server-only imports, so tests can load them directly.
 */

/**
 * PostgREST sends `.in()` lists in the URL, and the tally used to put every
 * official in a state into one request: New Hampshire's 419 ids made a ~16 KB
 * URL. Production accepted it, but it failed from a plain Node client after
 * 8 s in testing (2026-10-13), so it was one proxy limit away from silently
 * dropping a state's votes. 100 uuids is ~3.7 KB of URL anywhere.
 */
export const VOTE_ID_CHUNK = 100;

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type VoteTally = { restrict: number; total: number };

type Relevance = { kratom_relevance: string | null };
type MaybeArray<T> = T | T[] | null;
export type VoteMemberRow = {
  legislator_id: string | null;
  vote_value: number | null;
  bill_votes: MaybeArray<{ bills: MaybeArray<Relevance> }>;
};

const first = <T,>(v: MaybeArray<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

/**
 * Votes per official, and how many of them restricted kratom: a yes (1) on an
 * anti bill or a no (2) on a pro bill.
 */
export function tallyKratomVotes(rows: VoteMemberRow[]): Record<string, VoteTally> {
  const out: Record<string, VoteTally> = {};
  for (const r of rows) {
    if (!r.legislator_id) continue;
    const bv = first(r.bill_votes);
    const b = bv ? first(bv.bills) : null;
    if (!b) continue;
    const cur = (out[r.legislator_id] ??= { restrict: 0, total: 0 });
    cur.total++;
    if ((r.vote_value === 1 && b.kratom_relevance === "anti") || (r.vote_value === 2 && b.kratom_relevance === "pro")) cur.restrict++;
  }
  return out;
}

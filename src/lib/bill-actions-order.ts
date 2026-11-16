/**
 * Bill actions in the order they happened (PJ, 2026-11-13).
 *
 * North Dakota passed HB 1628 in a three-day special session, so a dozen
 * actions share one date. Sorting by date alone scrambled them ("Sent to
 * Governor" above "Signed by Speaker"). OpenStates gives each action an
 * `order`; LegiScan doesn't, so those keep the order the rows were stored in,
 * which follows the source's history list.
 */
export type OrderableAction = { action_date: string; seq?: number | string | null };

export function sortBillActions<T extends OrderableAction>(rows: T[]): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      if (a.row.action_date !== b.row.action_date) return a.row.action_date < b.row.action_date ? -1 : 1;
      const sa = a.row.seq == null ? null : Number(a.row.seq);
      const sb = b.row.seq == null ? null : Number(b.row.seq);
      if (sa !== null && sb !== null && Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
      return a.i - b.i;
    })
    .map(({ row }) => row);
}

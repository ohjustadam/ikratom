"use client";

import { useEffect, useState } from "react";
import type { BillViewer } from "@/app/api/bills/[id]/viewer/route";

/**
 * The per-reader half of a bill page, fetched once and shared.
 *
 * The bill page has FOUR separate places that need viewer-specific data —
 * the subscribe button, the actions-taken line, the federal "email your
 * officials" block, and the committee-leverage table. They sit in different
 * parts of a server-rendered tree, so passing a value down is not available
 * and a React context would mean wrapping the whole page.
 *
 * Instead the in-flight request is memoised per bill id at module scope, so
 * four components mounting in the same tick share ONE network call. Turning a
 * cached page into four round trips would have traded a Supabase problem for a
 * latency problem.
 *
 * The cache is per page-load, not persistent: it is keyed only by bill id and
 * lives as long as the module, so a client-side navigation to the same bill
 * reuses it while a full reload starts fresh. That is the right lifetime for
 * data that changes when the reader signs in or out.
 */
const inflight = new Map<string, Promise<BillViewer>>();

const EMPTY: BillViewer = {
  signedIn: false,
  subscribed: false,
  totalActions: 0,
  officialGroups: null,
  committeeMembers: [],
};

function load(billId: string): Promise<BillViewer> {
  const hit = inflight.get(billId);
  if (hit) return hit;
  const p = fetch(`/api/bills/${billId}/viewer`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : EMPTY))
    .then((d: BillViewer) => d ?? EMPTY)
    .catch(() => {
      // Drop the rejected promise so a later mount can retry rather than
      // inheriting a permanently failed cache entry.
      inflight.delete(billId);
      return EMPTY;
    });
  inflight.set(billId, p);
  return p;
}

/**
 * Returns the viewer payload plus whether it is still loading, so callers can
 * distinguish "no data yet" from "genuinely nothing" — rendering an empty
 * committee table during the fetch would look like a bill with no committee.
 */
export function useBillViewer(billId: string): { data: BillViewer; loading: boolean } {
  const [data, setData] = useState<BillViewer>(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load(billId).then((d) => {
      if (!alive) return;
      setData(d);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [billId]);

  return { data, loading };
}

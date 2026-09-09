"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useChromeMe } from "@/components/chrome/ChromeProvider";
import { BillsBrowser } from "./BillsBrowser";
import type { MyCommitteesResult } from "@/app/api/bills/my-committees/route";

/**
 * The per-viewer shell around the bill tracker.
 *
 * WHY (2026-09-08). /bills used to read searchParams AND cookies on the
 * server: `?state=XX` seeded the browser's filter, and
 * `?filter=in-my-committees` triggered a per-viewer narrow that resolved the
 * signed-in user's representatives and their committee assignments. Either one
 * forces a dynamic route, so every crawler hit — the overwhelming majority of
 * traffic — re-rendered the whole tracker against Supabase.
 *
 * Both move here. Search params are read client-side; the viewer's home state
 * comes from the /api/me chrome read; and the committee narrow is FETCHED from
 * /api/bills/my-committees, which stays dynamic because it is genuinely
 * per-person. The page itself is now a static file.
 *
 * The bill snapshot is still passed down from the server render — it is public
 * and identical for everyone, so it belongs in the cached HTML.
 */
type Bill = Parameters<typeof BillsBrowser>[0]["bills"][number];

export function BillsView({ bills }: { bills: Bill[] }) {
  const sp = useSearchParams();
  const me = useChromeMe();

  const wantsCommitteeFilter = sp.get("filter") === "in-my-committees";
  const stateParam = (sp.get("state") ?? "").toUpperCase();
  const initialState = /^[A-Z]{2}$/.test(stateParam) ? stateParam : null;

  const [committee, setCommittee] = useState<MyCommitteesResult | null>(null);

  useEffect(() => {
    if (!wantsCommitteeFilter) { setCommittee(null); return; }
    let alive = true;
    fetch("/api/bills/my-committees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { ok: false, reason: "filter temporarily unavailable" }))
      .then((d: MyCommitteesResult) => { if (alive) setCommittee(d); })
      .catch(() => { if (alive) setCommittee({ ok: false, reason: "filter temporarily unavailable" }); });
    return () => { alive = false; };
  }, [wantsCommitteeFilter]);

  const shown = useMemo(() => {
    if (!wantsCommitteeFilter || !committee?.ok) return bills;
    const keep = new Set(committee.billIds);
    return bills.filter((b) => keep.has(b.id));
  }, [bills, wantsCommitteeFilter, committee]);

  const count = wantsCommitteeFilter && committee?.ok ? shown.length : null;
  const reason = wantsCommitteeFilter && committee && !committee.ok ? committee.reason : null;

  return (
    <>
      {wantsCommitteeFilter && (
        <div className="mb-6 rounded-lg border-2 border-emerald-500 bg-emerald-950/15 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
                ⚡ Filtered view
              </p>
              <h2 className="mt-1 text-base font-bold text-zinc-100">
                Bills your reps are deciding
              </h2>
              <p className="mt-1 text-sm text-zinc-300">
                {committee === null
                  ? <>Matching bills against your representatives&apos; committees…</>
                  : reason
                  ? <>Filter unavailable — {reason}. Showing all bills below.</>
                  : count === 0
                  ? <>No active bills are currently in committees where your reps sit. That can change quickly — check back tomorrow.</>
                  : <>Narrowed to <strong>{count}</strong> active bill{count === 1 ? "" : "s"} in committees one of your representatives sits on.</>}
              </p>
            </div>
            <Link
              href="/bills"
              className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
            >
              Show all bills →
            </Link>
          </div>
        </div>
      )}

      <BillsBrowser bills={shown} userState={me.state} initialState={initialState} />
    </>
  );
}

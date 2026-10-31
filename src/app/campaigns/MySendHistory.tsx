"use client";

import { useEffect, useState } from "react";
import { getMyCampaignHistory, type MyCampaignHistory } from "@/modules/campaigns/history-actions";

/**
 * The member's own campaign record, fetched in the browser after load so
 * /campaigns stays a cached public page. null while loading or signed out.
 */
export function useMyCampaignHistory(signedIn: boolean): MyCampaignHistory | null {
  const [history, setHistory] = useState<MyCampaignHistory | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    getMyCampaignHistory().then((h) => { if (live) setHistory(h); }).catch(() => {});
    return () => { live = false; };
  }, [signedIn]);
  return signedIn ? history : null;
}

/** "✓ You sent · Oct 28" on a card the member has already acted on. */
export function SentBadge({ last, sends }: { last: string; sends: number }) {
  const d = new Date(last);
  // Civic dates read in Eastern time, like every other date on the site.
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const when = d.toLocaleDateString(undefined, {
    month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "America/New_York",
  });
  return (
    <span
      className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300"
      title={`You sent ${sends} email${sends === 1 ? "" : "s"} for this campaign, most recently on ${when}.`}
    >
      ✓ You sent · {when}
    </span>
  );
}

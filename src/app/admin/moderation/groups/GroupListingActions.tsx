"use client";

import { useState, useTransition } from "react";
import { decideGroupListing } from "@/modules/coalitions/listing-actions";

export function GroupListingActions({ coalitionId }: { coalitionId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (approve: boolean) =>
    start(async () => {
      const r = await decideGroupListing(coalitionId, approve);
      setMsg(r.ok ? (approve ? "Listed." : "Declined.") : r.error);
    });
  if (msg) return <p role="status" className="text-xs text-emerald-400">{msg}</p>;
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" disabled={pending} onClick={() => go(true)}
        className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">Approve</button>
      <button type="button" disabled={pending} onClick={() => go(false)}
        className="rounded-md border border-zinc-600 px-3 py-1 text-xs hover:border-red-500 disabled:opacity-50">Decline</button>
    </div>
  );
}

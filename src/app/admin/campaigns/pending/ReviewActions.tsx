"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePendingCampaign, rejectPendingCampaign } from "@/modules/admin/campaign-review-actions";

export function ReviewActions({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    if (!confirm("Approve and publish this campaign? Matched users will be notified.")) return;
    setError(null);
    startTransition(async () => {
      const r = await approvePendingCampaign(campaignId);
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function reject() {
    const reason = prompt("Reason for rejection (optional, audit-log only):") ?? undefined;
    if (reason === null) return;
    setError(null);
    startTransition(async () => {
      const r = await rejectPendingCampaign({ campaignId, reason: reason || undefined });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={approve}
        disabled={pending}
        className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "…" : "Approve + publish"}
      </button>
      <button
        onClick={reject}
        disabled={pending}
        className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

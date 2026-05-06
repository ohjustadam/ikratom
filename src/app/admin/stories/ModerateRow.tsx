"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateStory } from "@/modules/stories/actions";

export function ModerateRow({ storyId }: { storyId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await moderateStory({ storyId, decision: "approved" });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function reject() {
    const note = prompt("Reason for rejection (shown in audit log only — not sent to author):") ?? "";
    if (note === null) return;
    setError(null);
    startTransition(async () => {
      const r = await moderateStory({ storyId, decision: "rejected", note });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={approve}
        disabled={pending}
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "…" : "Approve"}
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

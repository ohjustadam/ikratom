"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { approveContent, removeContent } from "@/modules/forum/actions";

export function ModerationActions({
  targetType,
  targetId,
}: {
  targetType: "post" | "thread";
  targetId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await approveContent({ targetType, targetId });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function remove() {
    const reason = prompt("Reason for removal (optional, shown in audit log):") ?? "";
    if (reason === null) return;
    setError(null);
    startTransition(async () => {
      const r = await removeContent({ targetType, targetId, reason: reason || undefined });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        onClick={approve}
        disabled={pending}
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "…" : "Approve"}
      </button>
      <button
        onClick={remove}
        disabled={pending}
        className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
      >
        Remove
      </button>
      {error && (
        <span className="ml-2 text-xs text-red-300">{error}</span>
      )}
    </div>
  );
}

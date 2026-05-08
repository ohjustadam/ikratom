"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rejectCoverageRequest } from "@/modules/local-reps/actions";

export function RejectButton({
  state,
  locality,
  level,
}: {
  state: string;
  locality: string;
  level: "municipal" | "county";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    const reason = prompt(
      `Reject coverage request for ${locality}, ${state}? Optional reason (shown in audit only):`,
      "",
    );
    if (reason === null) return; // cancelled
    setErr(null);
    startTransition(async () => {
      const r = await rejectCoverageRequest({
        state,
        locality,
        level,
        reason: reason || undefined,
      });
      if ("error" in r) setErr(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
      >
        Reject
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}

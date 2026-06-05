"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFeedbackStatus } from "@/modules/feedback/actions";

export function FeedbackActions({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const next = status === "resolved" ? "open" : "resolved";

  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setFeedbackStatus(id, next);
            if ("error" in r) setErr(r.error);
            else router.refresh();
          })
        }
        className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
      >
        {status === "resolved" ? "Reopen" : "Mark resolved"}
      </button>
      {err && <p className="mt-1 text-[10px] text-red-400">{err}</p>}
    </div>
  );
}

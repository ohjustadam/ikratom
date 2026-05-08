"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestCoverage } from "@/modules/local-reps/actions";

export function RequestCoverageButton({
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
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    startTransition(async () => {
      const r = await requestCoverage({ state, locality, level });
      if ("error" in r) setErr(r.error ?? "Failed");
      else {
        setDone(true);
        router.refresh();
      }
    });
  }

  if (done) {
    return (
      <span className="inline-flex items-center gap-2 rounded-md border border-emerald-900/40 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300">
        ✓ Requested
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
      >
        {pending ? "Requesting…" : `Request coverage for ${locality}, ${state}`}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}

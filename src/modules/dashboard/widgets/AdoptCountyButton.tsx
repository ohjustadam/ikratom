"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adoptDerivedCounty } from "@/modules/local-reps/actions";

/**
 * One-click "pin my parish/county officials" for a resident of an
 * unincorporated community. Sets profiles.county to the derived parent admin
 * so the parish council flows into every rep surface, then refreshes so the
 * dashboard re-renders with them present (and this banner disappears).
 */
export function AdoptCountyButton({
  state,
  county,
}: {
  state: string;
  county: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    startTransition(async () => {
      const r = await adoptDerivedCounty({ state, county });
      if ("error" in r) setErr(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Adding…" : `Show my ${county} officials`}
      </button>
      {err && <span className="text-xs text-red-400">{err}</span>}
    </span>
  );
}

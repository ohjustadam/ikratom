"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncOneStateLegislators } from "@/modules/admin/sync-actions";

export function SyncStateButton({ state }: { state: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function onClick() {
    setMsg(null);
    startTransition(async () => {
      const result = await syncOneStateLegislators(state);
      if (result.error) setMsg(`✗ ${result.error}`);
      else setMsg(`✓ ${result.count} synced`);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:border-emerald-500 disabled:opacity-50"
      >
        {pending ? "…" : "Sync"}
      </button>
    </span>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCoalitionViaCode } from "@/modules/coalitions/actions";

export function JoinClient({ code }: { code: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await joinCoalitionViaCode(code);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/coalitions/${res.slug}`);
    });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className="w-full rounded-md bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Accepting…" : "✓ Accept invite"}
      </button>
      {error && (
        <p className="mt-3 rounded border border-red-700/40 bg-red-950/15 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      )}
      <p className="mt-3 text-[10px] text-zinc-500">
        Invite codes expire and have a use limit set by whoever created them. If the code is
        invalid or exhausted, an error will appear above.
      </p>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetOnboarding } from "@/modules/dashboard/actions";

/**
 * Lets a user re-run the cockpit tour. Resets onboarded_at to null
 * server-side, then router.push to /dashboard where the tour fires.
 */
export function ReplayTourButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await resetOnboarding();
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push("/dashboard");
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500 disabled:opacity-50"
      >
        {pending ? "Resetting…" : "Replay cockpit tour"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

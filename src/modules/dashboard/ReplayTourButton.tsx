"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetOnboarding } from "@/modules/dashboard/actions";

/**
 * Lets a user re-run the cockpit tour. Resets onboarded_at to null
 * server-side, then router.push to /dashboard where the tour fires.
 *
 * Lives next to CockpitCustomizer in the dashboard header so the
 * "customize" and "replay tour" controls sit together — the two
 * meta-controls for the cockpit. Previously buried in /account
 * under "Recognition & growth," which made replaying the tour a
 * three-click safari through unrelated settings.
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
        title="Replay the first-time cockpit walkthrough"
      >
        {pending ? "Resetting…" : "↻ Replay tour"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

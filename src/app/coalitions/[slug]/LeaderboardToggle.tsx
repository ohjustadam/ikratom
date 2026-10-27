"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLeaderboardOptIn } from "@/modules/coalitions/leaderboard-actions";

/** One tap to show or hide yourself on the group leaderboard (off by default). */
export function LeaderboardToggle({ coalitionId, slug, optedIn }: { coalitionId: string; slug: string; optedIn: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button type="button" disabled={pending} aria-pressed={optedIn}
        onClick={() => start(async () => {
          setError(null);
          const r = await setLeaderboardOptIn(coalitionId, slug, !optedIn);
          if (!r.ok) setError(r.error); else router.refresh();
        })}
        className={`min-h-11 rounded-md px-4 text-sm font-semibold disabled:opacity-40 ${optedIn
          ? "border border-zinc-700 text-zinc-300 hover:border-red-400"
          : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"}`}>
        {pending ? "Saving…" : optedIn ? "Hide me from the leaderboard" : "Show me on the leaderboard"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
    </div>
  );
}

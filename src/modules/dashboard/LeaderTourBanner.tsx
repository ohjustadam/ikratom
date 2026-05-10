"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { replayLeaderTour } from "@/modules/admin/user-actions";

/**
 * Sticky banner shown on every page when:
 *   - user is_advocate_leader = true
 *   - leader_acknowledged_at IS NULL
 *
 * Reminds them they owe the tour + acknowledgment. Clicking
 * "Resume" force-fires the tour again so they can pick up where
 * they left off (or restart if they nuked localStorage).
 */
export function LeaderTourBanner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function resumeTour() {
    startTransition(async () => {
      await replayLeaderTour();
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="border-b border-amber-700/40 bg-amber-950/40 px-4 py-2 text-center text-xs text-amber-200">
      <span className="font-semibold">📋 You haven&apos;t finished the leader walkthrough.</span>{" "}
      Some leader functions are gated until you complete it and sign the acknowledgment.{" "}
      <button
        onClick={resumeTour}
        disabled={pending}
        className="font-bold text-amber-300 underline hover:text-amber-100 disabled:opacity-50"
      >
        Resume tour →
      </button>
    </div>
  );
}

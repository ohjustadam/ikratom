"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimMyLeaderInvite } from "@/modules/admin/leader-invite-actions";

/** "I've done it": re-checks now instead of waiting for the next visit. */
export function CheckAgainButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function check() {
    setMsg(null);
    start(async () => {
      const r = await claimMyLeaderInvite();
      if (r.state === "applied") {
        router.push("/dashboard?leader=welcome");
        router.refresh();
      } else if (r.state === "waiting") {
        setMsg("Not quite yet. The steps without a ✓ are still open.");
        router.refresh();
      } else if (r.state === "error") {
        setMsg(r.message);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div>
      <button
        onClick={check}
        disabled={pending}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Checking…" : "I've done these, check again"}
      </button>
      {msg && <p className="mt-2 text-sm text-amber-300">{msg}</p>}
    </div>
  );
}

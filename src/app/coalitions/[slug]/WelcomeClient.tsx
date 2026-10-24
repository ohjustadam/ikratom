"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishWelcome } from "@/modules/coalitions/home-actions";

/** "Hide this": closes the welcome checklist for good. */
export function FinishWelcome({ coalitionId }: { coalitionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => start(async () => { await finishWelcome(coalitionId); router.refresh(); })}
      className="mt-3 text-[11px] text-zinc-500 hover:text-zinc-300">
      {pending ? "Hiding…" : "Hide this checklist"}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBannedStateSafeMode } from "../actions-safe-mode";
import type { SafeMode } from "../safe-mode";

/**
 * Banned-state safe mode (migration 0275). Explained in full once; after the
 * member chooses, a one-line status they can flip.
 */
export function SafeModeCard({ mode }: { mode: SafeMode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const choose = (on: boolean) =>
    start(async () => {
      const r = await setBannedStateSafeMode(on);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });

  if (mode.chosen) {
    return (
      <p className="mb-4 text-xs text-zinc-400">
        {mode.active ? `🛡️ Safe mode is on for letters from ${mode.stateName}.` : `Safe mode is off for letters from ${mode.stateName}.`}{" "}
        <button type="button" disabled={pending} onClick={() => choose(!mode.active)} className="underline hover:text-zinc-200 disabled:opacity-50">
          {mode.active ? "Turn it off" : "Turn it on"}
        </button>
        {error && <span className="ml-2 text-red-300">{error}</span>}
      </p>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-amber-800/60 bg-amber-950/20 p-4 text-sm text-zinc-200">
      <h2 className="font-semibold text-amber-200">🛡️ Writing from {mode.stateName}, where kratom is banned</h2>
      <p className="mt-2 text-zinc-300">
        Asking lawmakers to change a law is protected speech. What can put you at risk is writing that you use
        kratom now: from {mode.stateName}, that is a signed statement sent to a government inbox. Safe mode is on:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-300">
        <li>Letters to officials outside {mode.stateName} leave out your city, state and ZIP.</li>
        <li>Lines that say you use kratom now are flagged, with past-tense wording one click away.</li>
        <li>
          Your city and state stay on letters to your own legislators. That is what makes them read it, and
          they are the ones who can lift the ban.
        </li>
      </ul>
      <p className="mt-2 text-xs text-zinc-500">This is a safety feature, not legal advice.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => choose(true)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
          Keep safe mode on
        </button>
        <button type="button" disabled={pending} onClick={() => choose(false)} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-50">
          Turn it off
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </section>
  );
}

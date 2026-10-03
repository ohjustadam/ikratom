"use client";

import { useState, useTransition } from "react";
import { useChrome } from "./ChromeProvider";
import { answerStateQuestion } from "@/modules/onboarding/actions";
import { US_STATE_CODES, PREFER_NOT_TO_SAY } from "@/lib/us-states";

/**
 * The one REQUIRED question for members who never answered it (owner decision
 * 2026-10-03). 18 of 46 members had no state, so home-state alerts never
 * reached them. "Prefer not to say" is a full answer: those members get the
 * national digest, i.e. the most important news from everywhere.
 *
 * Driven by /api/me (`stateAnswered`), so it costs no server render and never
 * shows to anonymous visitors. No close button on purpose; it asks once.
 */
export function StateQuestionGate() {
  const { me, loading } = useChrome();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (loading || !me?.userId || me.stateAnswered || done) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="state-q-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <form
        action={(fd) => start(async () => {
          const r = await answerStateQuestion(fd);
          if ("error" in r) setError(r.error); else setDone(true);
        })}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 shadow-2xl"
      >
        <h2 id="state-q-title" className="text-lg font-bold">Which state do you advocate from?</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          One question, asked once. It sends you your state&apos;s bills, hearings and news the moment they break.
          Rather not say? You&apos;ll get the most important news from every state instead.
          Other members never see your state.
        </p>
        <label htmlFor="state-q" className="mt-4 block text-xs font-medium text-zinc-400">Your state</label>
        <select id="state-q" name="state" required defaultValue=""
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none">
          <option value="" disabled>Choose…</option>
          <option value={PREFER_NOT_TO_SAY}>Prefer not to say</option>
          {US_STATE_CODES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {error && <p className="mt-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button type="submit" disabled={pending}
          className="mt-5 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import Link from "@/components/Link";

/**
 * A first-visit coach mark on the admin campaign and intel screens: one plain
 * sentence on what the screen is for and a link to the step-by-step
 * walkthrough (/how-it-works/for-leaders/walkthrough). Once closed it shrinks
 * to a small "Step-by-step help" link, so the walkthrough stays one click away.
 * Saved on this device only (localStorage), one key per screen.
 */
const WALKTHROUGH = "/how-it-works/for-leaders/walkthrough";
const listeners = new Set<() => void>();

const keyFor = (screen: string) => `ikratom:walkthrough-hint:v1:${screen}`;

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => { listeners.delete(fn); window.removeEventListener("storage", fn); };
}

export function WalkthroughHint({ screen, text, part }: { screen: string; text: string; part: 1 | 2 | 3 }) {
  const key = keyFor(screen);
  const closed = useSyncExternalStore(
    subscribe,
    () => { try { return localStorage.getItem(key) === "1"; } catch { return true; } },
    () => true,
  );
  const href = `${WALKTHROUGH}#part-${part}`;

  if (closed) {
    return (
      <Link href={href} className="mb-4 inline-block text-sm text-emerald-300 underline underline-offset-4 hover:text-emerald-200">
        📋 Step-by-step help
      </Link>
    );
  }

  const close = () => {
    try { localStorage.setItem(key, "1"); } catch { /* storage blocked: it just shows again next time */ }
    listeners.forEach((fn) => fn());
  };

  return (
    <div role="note" className="mb-6 rounded-lg border-2 border-emerald-700/60 bg-emerald-950/30 p-4">
      <p className="text-base font-semibold text-emerald-200">New here? 👋</p>
      <p className="mt-1 text-base text-zinc-200">{text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link href={href} className="rounded-md bg-emerald-500 px-4 py-2 text-base font-semibold text-zinc-950 hover:bg-emerald-400">
          Show me step by step
        </Link>
        <button type="button" onClick={close} className="rounded-md px-3 py-2 text-base text-zinc-400 hover:text-zinc-200">
          Got it, hide this
        </button>
      </div>
    </div>
  );
}

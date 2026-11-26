"use client";

import { useSyncExternalStore } from "react";
import Link from "@/components/Link";

/**
 * One section of the walkthrough as a tick-as-you-go checklist. Ticks are
 * saved on this device only (localStorage), so nothing is sent anywhere and
 * the page works signed out.
 */
export type Step = { id: string; text: string; href?: string; linkLabel?: string; tip?: string };

const KEY = "ikratom:walkthrough:v1";
const listeners = new Set<() => void>();

function read(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => { listeners.delete(fn); window.removeEventListener("storage", fn); };
}
function toggle(id: string) {
  const done = new Set(read().split(",").filter(Boolean));
  if (done.has(id)) done.delete(id); else done.add(id);
  try { localStorage.setItem(KEY, [...done].join(",")); } catch { /* storage blocked: ticks just won't stick */ }
  listeners.forEach((fn) => fn());
}

export function Checklist({ steps }: { steps: Step[] }) {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  const done = new Set(raw.split(",").filter(Boolean));
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const ticked = done.has(s.id);
        return (
          <li key={s.id} className={`rounded-lg border-2 p-4 ${ticked ? "border-emerald-800 bg-emerald-950/20" : "border-zinc-800 bg-zinc-950/40"}`}>
            <label className="flex cursor-pointer items-start gap-4">
              <input
                type="checkbox"
                checked={ticked}
                onChange={() => toggle(s.id)}
                className="mt-1 h-7 w-7 shrink-0 rounded border-zinc-600 bg-zinc-950 accent-emerald-500"
                aria-label={`Step ${i + 1} done`}
              />
              <span className="text-lg leading-relaxed text-zinc-100">
                <span className="font-bold text-emerald-300">Step {i + 1}. </span>
                {s.text}
              </span>
            </label>
            {(s.href || s.tip) && (
              <div className="mt-2 pl-11 text-base">
                {s.tip && <p className="text-zinc-400">{s.tip}</p>}
                {s.href && (
                  <Link href={s.href} className="mt-1 inline-block font-semibold text-emerald-300 underline underline-offset-4">
                    {s.linkLabel ?? "Open it"} →
                  </Link>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

"use client";

import { useState, useTransition } from "react";
import { triggerCron, type CronTriggerResult } from "@/modules/admin/console-actions";

const ENDPOINTS = [
  {
    name: "daily-sync",
    label: "Vercel daily-sync",
    purpose: "News RSS across all 50 states + OpenStates bill refresh. Normally fires daily at 12:00 UTC.",
  },
  {
    name: "fire-waves",
    label: "Fire scheduled waves",
    purpose: "Email/push fan-out for queued campaign waves. Normally fires hourly via GH Actions.",
  },
  {
    name: "reverify-local-officials",
    label: "Reverify local officials",
    purpose: "Re-check municipal officials currency. Normally fires weekly Sun 08:00 UTC.",
  },
] as const;

/**
 * Manual cron trigger panel — fire a /api/cron/* endpoint server-side
 * with the CRON_SECRET. Useful when an automation hasn't run yet and
 * you don't want to wait for the next scheduled tick (e.g. you just
 * approved a critical alert and want it fanned out immediately
 * instead of waiting up to 30 min).
 */
export function CronTriggerPanel() {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CronTriggerResult>>({});
  const [, startTransition] = useTransition();

  function fire(endpoint: typeof ENDPOINTS[number]["name"]) {
    setRunning(endpoint);
    startTransition(async () => {
      const r = await triggerCron(endpoint);
      setResults((s) => ({ ...s, [endpoint]: r }));
      setRunning(null);
    });
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
        ⚡ Manual cron triggers
      </h2>
      <p className="mt-1 text-[11px] text-zinc-400">
        Fire a Vercel cron endpoint right now instead of waiting for its next scheduled tick.
        GitHub Actions workflows aren&apos;t exposed here — trigger those from the GitHub UI
        (or the Actions tab) since they require workflow_dispatch tokens.
      </p>

      <ul className="mt-3 space-y-2">
        {ENDPOINTS.map((ep) => {
          const r = results[ep.name];
          return (
            <li key={ep.name} className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] font-bold text-zinc-200">{ep.label}</span>
                <span className="text-[10px] text-zinc-500">{ep.name}</span>
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-500">{ep.purpose}</p>
              <button
                type="button"
                onClick={() => fire(ep.name)}
                disabled={running === ep.name}
                className="mt-2 min-h-[40px] rounded-md bg-emerald-500 px-4 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                {running === ep.name ? "Firing…" : "🚀 Fire now"}
              </button>

              {r && !r.ok && (
                <p className="mt-2 rounded border border-red-700/40 bg-red-950/15 px-2 py-1 text-[10px] text-red-200">
                  ✗ {r.error}
                </p>
              )}
              {r && r.ok && (
                <div className="mt-2 rounded border border-emerald-700/40 bg-emerald-950/15 px-2 py-1 text-[10px] text-emerald-200">
                  <p>✓ HTTP {r.status} · {r.elapsedMs}ms</p>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-zinc-300">
                    {r.body.slice(0, 800)}{r.body.length > 800 ? "…" : ""}
                  </pre>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerCloudResolution } from "@/modules/local-reps/actions";

/**
 * Admin-only "Resolve queue now" button. Kicks the cloud resolution workflow
 * (cron-localreps-cloud.yml) on demand instead of waiting for the 6-hourly
 * scheduled run. The actual find→extract→verify happens in GitHub Actions
 * (SearXNG container + headless Chromium); this just dispatches it and tells
 * the admin to check back. The waiting users get notified automatically when
 * the run inserts officials.
 */
export function ResolveQueueButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; url?: string } | null>(null);

  function onClick() {
    setMsg(null);
    start(async () => {
      const r = await triggerCloudResolution();
      if ("ok" in r) {
        setMsg({
          kind: "ok",
          text: "Cloud resolver started. It searches, extracts + verifies officials over the next few minutes, then fulfills any it can and notifies waiting users. Refresh shortly.",
          url: r.runsUrl,
        });
        // Give the run time to land, then refresh the queue.
        setTimeout(() => router.refresh(), 90_000);
      } else {
        setMsg({ kind: "err", text: r.error });
      }
    });
  }

  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Starting cloud run…" : "⚡ Resolve queue now (cloud)"}
        </button>
        <span className="text-[11px] text-zinc-500">
          Runs the SearXNG + headless-browser resolver in the cloud immediately, instead of waiting for the 6-hourly auto-run.
        </span>
      </div>
      {msg && (
        <p
          className={`mt-2 rounded-md px-3 py-2 text-xs ${
            msg.kind === "ok"
              ? "border border-emerald-700/50 bg-emerald-950/20 text-emerald-200"
              : "border border-red-900/40 bg-red-950/40 text-red-300"
          }`}
        >
          {msg.text}{" "}
          {msg.url && (
            <a href={msg.url} target="_blank" rel="noreferrer" className="underline hover:text-emerald-300">
              view run →
            </a>
          )}
        </p>
      )}
    </div>
  );
}

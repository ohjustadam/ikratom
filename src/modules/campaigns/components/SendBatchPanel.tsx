"use client";

import { useEffect, useState, useTransition } from "react";
import {
  enqueueCampaignSend,
  getBatchProgress,
  cancelBatch,
  type BatchProgress,
} from "../send-batch-actions";

/**
 * SendBatchPanel — queue a campaign send that outlives the browser tab.
 *
 * Owner directive 2026-08-22: "closing the tab should never kill the action."
 * So this deliberately does NOT hold the send open. It hands the work to the
 * queue and then just reports on it — the user can close the laptop, and the
 * same panel on their phone shows the same progress, because the state lives
 * in the database rather than in this component.
 *
 * Everything shown here is a real number from the server. No optimistic
 * counters: this session has repeatedly found UI that claimed success while
 * the action underneath did less (the 20-target cap, the truncating mailto),
 * and a progress bar that lies about email is worse than no progress bar.
 */
export function SendBatchPanel({
  campaignSlug,
  selectedIds,
  className = "",
}: {
  campaignSlug: string;
  selectedIds: string[];
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<BatchProgress>(null);
  const [plan, setPlan] = useState<{ part: number; count: number; sameDay: boolean }[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active =
    progress && ["queued", "sending", "paused"].includes(progress.status);

  // Poll while a batch is live. 5s is frequent enough to feel alive and slow
  // enough that an idle tab is not hammering the origin — every one of these
  // is a billable function invocation.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const p = await getBatchProgress(campaignSlug);
      if (!cancelled) setProgress(p);
    }
    tick();
    if (!active) return;
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [campaignSlug, active]);

  function queue() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await enqueueCampaignSend({ campaignSlug, legislatorIds: selectedIds });
      if (!res.ok) { setError(res.error); return; }
      setPlan(res.parts);
      const skips: string[] = [];
      // Say plainly what was dropped and why. Silently sending to fewer people
      // than the user selected is the failure mode we keep finding.
      if (res.skippedAlreadySent > 0) skips.push(`${res.skippedAlreadySent} already contacted`);
      if (res.skippedNoEmail > 0) skips.push(`${res.skippedNoEmail} have no usable email`);
      if (res.skippedOutOfScope > 0) skips.push(`${res.skippedOutOfScope} outside this campaign`);
      setNotice(
        `Queued ${res.total} email${res.total === 1 ? "" : "s"} from your ${res.providerLabel}.` +
        (skips.length ? ` Skipped: ${skips.join(", ")}.` : ""),
      );
      setProgress(await getBatchProgress(campaignSlug));
    });
  }

  function stop() {
    if (!progress) return;
    startTransition(async () => {
      const res = await cancelBatch(progress.id);
      if (!res.ok) setError(res.error ?? "Could not cancel.");
      setProgress(await getBatchProgress(campaignSlug));
    });
  }

  const pct = progress && progress.total > 0
    ? Math.round(((progress.sent + progress.failed) / progress.total) * 100)
    : 0;

  return (
    <div className={`rounded-md border border-emerald-800/40 bg-emerald-950/10 p-4 ${className}`}>
      {!active && (
        <>
          <p className="text-sm text-zinc-200">
            Send in the background — one personal email per recipient, from your own address.
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            You can close this page. Each official gets their own message, never a group email,
            so nothing looks like bulk mail to their office.
          </p>
          <button
            type="button"
            onClick={queue}
            disabled={pending || selectedIds.length === 0}
            className="mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
          >
            {pending ? "Queueing…" : `Queue ${selectedIds.length} email${selectedIds.length === 1 ? "" : "s"}`}
          </button>
        </>
      )}

      {plan && plan.length > 1 && (
        <div className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300">
          <p className="font-semibold text-emerald-300">
            This needs {plan.length} parts — your provider caps how much can go out per day.
          </p>
          <ul className="mt-1 space-y-0.5">
            {plan.map((p) => (
              <li key={p.part}>
                Part {p.part}: {p.count} email{p.count === 1 ? "" : "s"}{" "}
                <span className="text-zinc-500">{p.sameDay ? "— today" : "— next day"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-zinc-500">
            Nothing for you to do. Later parts send automatically and we&apos;ll tell you when they do.
          </p>
        </div>
      )}

      {progress && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>
              {progress.status === "complete" ? "Sent" :
               progress.status === "cancelled" ? "Cancelled" :
               progress.status === "paused" ? "Paused" : "Sending"}
              {" · "}
              {progress.sent} of {progress.total}
              {progress.failed > 0 && <span className="text-amber-400"> · {progress.failed} failed</span>}
            </span>
            <span className="text-zinc-500">{progress.providerLabel}</span>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Send progress"
          >
            <div
              className={`h-full transition-all ${progress.status === "cancelled" ? "bg-zinc-600" : "bg-emerald-500"}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {progress.pauseReason && (
            <p className="mt-2 rounded border border-amber-800/50 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-200">
              {progress.pauseReason}
            </p>
          )}

          {active && (
            <button
              type="button"
              onClick={stop}
              disabled={pending}
              className="mt-2 text-xs text-zinc-400 underline decoration-dotted hover:text-amber-300"
            >
              Stop the remaining sends
            </button>
          )}
          {progress.status === "cancelled" && (
            <p className="mt-1 text-[11px] text-zinc-500">
              Messages already delivered can&apos;t be recalled.
            </p>
          )}
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}
      {error && (
        <p className="mt-2 rounded border border-red-900/50 bg-red-950/20 px-2.5 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

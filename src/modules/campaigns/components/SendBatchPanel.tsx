"use client";

import { useEffect, useState, useTransition } from "react";
import {
  enqueueCampaignSend,
  getBatchProgress,
  continueMySend,
  cancelBatch,
  getSendAllowance,
  type BatchProgress,
  type SendAllowance,
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
  subject,
  body,
  primary = false,
  blockedReason = null,
  className = "",
}: {
  campaignSlug: string;
  selectedIds: string[];
  /** The composer's subject + letter. Sent as written (per-recipient fields filled at send time). */
  subject?: string;
  body?: string;
  /** The main one-click card: big button, plain-language copy. */
  primary?: boolean;
  /** Set when the letter failed screening: the button is off and says why. */
  blockedReason?: string | null;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<BatchProgress>(null);
  const [plan, setPlan] = useState<{ part: number; count: number; sameDay: boolean }[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedHere, setQueuedHere] = useState(false);
  const [allowance, setAllowance] = useState<SendAllowance>(null);

  // Today's safe sending allowance (rolling 24h, the count the queue enforces),
  // refreshed as letters go out, so people can watch their account stay well
  // inside its provider's limit (owner ask 2026-10-22).
  const sentSoFar = progress?.sent ?? 0;
  useEffect(() => {
    let cancelled = false;
    getSendAllowance().then((a) => { if (!cancelled) setAllowance(a); }).catch(() => {});
    return () => { cancelled = true; };
  }, [sentSoFar]);

  const active =
    progress && ["queued", "sending", "paused"].includes(progress.status);

  // While a batch is live and this page is open, DRIVE it: each call sends a
  // ~15s slice and returns real progress, then we wait 3s and go again (a
  // chain, never overlapping). Without this a one-click send waited for the
  // scheduled worker, which GitHub runs only a few times a day. Closing the
  // page just stops the driving; the worker finishes the rest.
  const batchId = progress?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      const p = active && batchId
        ? await continueMySend(campaignSlug, batchId).catch(() => getBatchProgress(campaignSlug))
        : await getBatchProgress(campaignSlug);
      if (cancelled) return;
      setProgress(p);
      if (p && ["queued", "sending"].includes(p.status)) timer = setTimeout(tick, 3000);
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [campaignSlug, active, batchId]);

  function queue() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await enqueueCampaignSend({ campaignSlug, legislatorIds: selectedIds, subject, body });
      if (!res.ok) { setError(res.error); return; }
      setQueuedHere(true);
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
      {!active && !(queuedHere && progress?.status === "complete") && (
        <>
          {!primary && (
            <p className="text-sm text-zinc-200">
              Send in the background — one personal email per recipient, from your own address.
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-400">
            Each official gets their own letter, addressed to them by name, exactly as written above.
            Sending is paced to protect your account; you can close this page and it keeps going.
          </p>
          <button
            type="button"
            onClick={queue}
            disabled={pending || selectedIds.length === 0 || !!blockedReason}
            className={primary
              ? "mt-3 flex w-full items-center justify-center gap-3 rounded-lg bg-emerald-500 px-6 py-3.5 text-base font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-40"
              : "mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"}
          >
            {pending ? "Starting…" : primary
              ? `Send ${selectedIds.length} personal email${selectedIds.length === 1 ? "" : "s"} →`
              : `Queue ${selectedIds.length} email${selectedIds.length === 1 ? "" : "s"}`}
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

      {allowance && allowance.limit > 0 && <AllowanceBar a={allowance} />}

      {notice && <p className="mt-2 text-xs text-emerald-300">{notice}</p>}
      {error && (
        <p className="mt-2 rounded border border-red-900/50 bg-red-950/20 px-2.5 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Today: 37 of 425 used · 388 left" — the account-safety bar. Real numbers only. */
function AllowanceBar({ a }: { a: NonNullable<SendAllowance> }) {
  const used = Math.min(a.used, a.limit);
  const pct = Math.round((used / a.limit) * 100);
  const left = Math.max(0, a.limit - a.used);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[11px] text-zinc-400">
        <span>Today&apos;s safe sending: {used.toLocaleString("en-US")} of {a.limit.toLocaleString("en-US")} used</span>
        <span className={left === 0 ? "text-amber-300" : "text-zinc-500"}>
          {left === 0 ? "resumes tomorrow" : `${left.toLocaleString("en-US")} left`}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar"
        aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Daily sending allowance for your ${a.providerLabel} account`}>
        <div className={`h-full ${pct >= 80 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        {a.providerLabel}: we stop well before your provider&apos;s daily limit. Anything over pauses and finishes tomorrow.
      </p>
    </div>
  );
}

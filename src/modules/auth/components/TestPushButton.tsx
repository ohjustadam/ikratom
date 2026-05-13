"use client";

import { useState, useTransition } from "react";
import { sendTestPushToMe } from "../actions-push";

/**
 * Confidence-building action: after a user enables push, lets them
 * fire a self-push immediately so they can verify the notification
 * lands on their device. Closes the "did it actually work?" doubt
 * gap before a real alert fires.
 */
export function TestPushButton({ hasSubscriptions }: { hasSubscriptions: boolean }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "ok"; sent: number; subscriptions: number; pruned: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  if (!hasSubscriptions) return null;

  function send() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const r = await sendTestPushToMe();
      if ("error" in r && r.error) {
        setStatus({ kind: "error", message: r.error });
      } else if ("ok" in r && r.ok) {
        setStatus({
          kind: "ok",
          sent: r.sent ?? 0,
          subscriptions: r.subscriptions ?? 0,
          pruned: r.pruned ?? 0,
        });
      }
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
      >
        {pending ? "Sending…" : "🔔 Send test push to my device"}
      </button>

      {status.kind === "ok" && (
        <p className="mt-2 rounded border border-emerald-700/40 bg-emerald-950/15 px-3 py-2 text-xs text-emerald-200">
          ✓ Test push fired to {status.sent} of {status.subscriptions} subscribed
          device{status.subscriptions === 1 ? "" : "s"}. Check your notification
          shade now — if you don&apos;t see it within 10 seconds, your browser may
          have notifications muted at the OS level.
          {status.pruned > 0 && (
            <span className="mt-1 block text-zinc-400">
              ({status.pruned} dead subscription{status.pruned === 1 ? "" : "s"} pruned.)
            </span>
          )}
        </p>
      )}
      {status.kind === "error" && (
        <p className="mt-2 rounded border border-red-700/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          ✗ {status.message}
        </p>
      )}
    </div>
  );
}

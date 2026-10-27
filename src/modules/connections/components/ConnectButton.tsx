"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeConnection, requestConnection, respondConnection } from "../actions";

export type ConnectionState = "none" | "pending_out" | "pending_in" | "friends";

const btn = "rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50";
const primary = `${btn} bg-emerald-500 text-zinc-950 hover:bg-emerald-400`;
const ghost = `${btn} border border-zinc-700 text-zinc-200 hover:border-emerald-500`;

/**
 * Connect / Requested / Accept·Decline / Friends, for one other member.
 * The state comes from get_profile_view (or get_my_connections) and every
 * click goes through the 0287 RPCs, which re-check blocks and visibility.
 */
export function ConnectButton({ userId, handle, state: initial }: { userId: string; handle: string; state: ConnectionState }) {
  const router = useRouter();
  const [state, setState] = useState<ConnectionState>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true; state: string } | { error: string }>, next: (s: string) => ConnectionState) =>
    start(async () => {
      setErr(null);
      const r = await fn();
      if ("error" in r) return setErr(r.error);
      setState(next(r.state));
      router.refresh();
    });

  const asState = (s: string): ConnectionState => (s === "friends" ? "friends" : s === "pending_out" ? "pending_out" : "none");

  return (
    <span className="flex flex-wrap items-center gap-2">
      {state === "none" && (
        <button type="button" disabled={pending} className={primary} onClick={() => run(() => requestConnection(userId), asState)}>
          {pending ? "Sending…" : "＋ Connect"}
        </button>
      )}
      {state === "pending_out" && (
        <button type="button" disabled={pending} className={ghost} title="Cancel your request"
          onClick={() => run(() => removeConnection(userId), () => "none")}>
          {pending ? "Cancelling…" : "Requested · Cancel"}
        </button>
      )}
      {state === "pending_in" && (
        <>
          <button type="button" disabled={pending} className={primary} onClick={() => run(() => respondConnection(userId, true), asState)}>
            Accept
          </button>
          <button type="button" disabled={pending} className={ghost} onClick={() => run(() => respondConnection(userId, false), () => "none")}>
            Decline
          </button>
        </>
      )}
      {state === "friends" && (
        <button type="button" disabled={pending} className={ghost}
          onClick={() => {
            if (!confirm(`Remove ${handle} from your friends? They won't be told.`)) return;
            run(() => removeConnection(userId), () => "none");
          }}>
          {pending ? "Removing…" : "✓ Friends · Unfriend"}
        </button>
      )}
      {err && <span role="alert" className="text-xs text-red-400">{err}</span>}
    </span>
  );
}

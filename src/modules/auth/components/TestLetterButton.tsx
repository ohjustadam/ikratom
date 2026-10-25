"use client";

import { useState, useTransition } from "react";
import { sendTestLetterToMe } from "../actions-test-letter";

/**
 * "Send a test letter to myself": one letter from the member's connected
 * mailbox to that same mailbox, so they can see what officials receive,
 * footer included, before they send a campaign.
 */
export function TestLetterButton({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function send() {
    setStatus(null);
    startTransition(async () => {
      try {
        const r = await sendTestLetterToMe();
        setStatus("error" in r
          ? { ok: false, message: r.error }
          : { ok: true, message: `Sent to ${r.to}. Check your inbox (and spam) in a minute.` });
      } catch {
        setStatus({ ok: false, message: "Couldn't reach iKratom. Check your connection and try again." });
      }
    });
  }

  return (
    <div>
      <p className="text-xs text-zinc-400">
        See exactly what an official receives: one letter from <span className="font-mono text-zinc-300">{email}</span> to itself.
      </p>
      <button
        type="button"
        onClick={send}
        disabled={pending}
        className="mt-2 rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500 disabled:opacity-50"
      >
        {pending ? "Sending…" : "✉️ Send a test letter to myself"}
      </button>
      {status && (
        <p role="status" className={`mt-2 text-xs ${status.ok ? "text-emerald-300" : "text-red-300"}`}>{status.message}</p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { resendSignupLink } from "../actions";

/**
 * "Send me a new link" for someone whose confirmation link expired, was
 * replaced by a newer email, or never arrived. The server answers the same
 * way whether or not the address has an account waiting.
 */
export function ResendLinkForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setMsg(null);
    const fd = new FormData();
    fd.set("email", email);
    startTransition(async () => {
      const r = await resendSignupLink(fd);
      setMsg(
        r.error
          ? { ok: false, text: r.error }
          : {
              ok: true,
              text: "If that address is waiting for confirmation, a new link is on its way. Use the newest email. Already confirmed? Just sign in.",
            },
      );
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-2">
        <input
          type="email"
          aria-label="Email for a new confirmation link"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          // It sits inside the sign-in form: Enter must send the link, not
          // submit that form.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (email && !pending) send();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-base text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={pending || !email}
          className="shrink-0 rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/60 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send a new link"}
        </button>
      </div>
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { requestDmSetup } from "@/modules/dm/actions";

/**
 * For a member who hasn't opened Messages yet, so has no encryption key and
 * can't be written to. One tap sends them "@you wants to message you"; their
 * tap on it turns private messages on and opens a chat with you.
 */
export function LetThemKnow({ id, handle }: { id: string; handle: string }) {
  const [state, setState] = useState<"idle" | "sent" | "already" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (state === "ready") return <p className="text-xs text-emerald-300">{handle} just turned messages on. Search again to start.</p>;
  if (state !== "idle") {
    return (
      <p className="text-xs text-emerald-300">
        {state === "sent" ? `Sent. ${handle} gets a notification, and you'll be able to message once they open it.` : `${handle} already has your note from this week.`}
      </p>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <span className="text-xs text-amber-300">Hasn&apos;t opened Messages yet.</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const r = await requestDmSetup(id);
          if ("error" in r) setError(r.error);
          else setState(r.status);
        })}
        className="min-h-9 rounded-md border border-emerald-700/60 px-3 text-xs font-semibold text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Let them know"}
      </button>
      {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
    </div>
  );
}

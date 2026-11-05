"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCoalitionViaCode } from "@/modules/coalitions/actions";

/** The database's reasons, in words a new member can act on. */
function friendly(error: string): string {
  if (/not found|invalid/i.test(error)) return "This invite link isn't working. Ask the person who shared it for a fresh one.";
  if (/expired/i.test(error)) return "This invite has expired. Ask the organizer for a fresh link.";
  if (/exhausted/i.test(error)) return "This invite has been used up. Ask the organizer for a fresh link.";
  if (/sign in/i.test(error)) return "Sign in first, then open the link again.";
  return "Couldn't join just now. Try again in a moment.";
}

/** One tap to join. `auto` joins on arrival (the member just confirmed their email to get here). */
export function JoinClient({ code, groupName, auto = false }: { code: string; groupName: string; auto?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await joinCoalitionViaCode(code);
      if (!res.ok) { setError(friendly(res.error)); return; }
      router.push(`/coalitions/${res.slug}`);
    });
  }

  useEffect(() => {
    if (auto && !fired.current) { fired.current = true; accept(); }
    // accept is stable for this code; run once on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <button type="button" onClick={accept} disabled={pending}
        className="w-full rounded-md bg-emerald-500 px-4 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50">
        {pending ? "Joining…" : `✓ Join ${groupName}`}
      </button>
      {error && (
        <p className="mt-3 rounded border border-red-700/40 bg-red-950/15 px-3 py-2 text-xs text-red-200">{error}</p>
      )}
    </div>
  );
}

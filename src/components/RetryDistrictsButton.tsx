"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryDistrictLookup } from "@/modules/profile/retry-districts-action";

/**
 * Reusable button: re-runs the Census district lookup for the signed-in
 * user's saved address. Renders inline feedback + refreshes the page
 * on success so any "needs districts" UI clears automatically.
 *
 * Drop in next to a banner that says "we couldn't auto-detect your
 * districts" — anywhere on the site.
 */
export function RetryDistrictsButton({
  userState,
  label = "🔁 Retry district lookup",
  className,
}: {
  userState: string | null;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "matched"; cd: string | null; ssd: string | null; shd: string | null }
    | { kind: "no-match" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  function onClick() {
    setState({ kind: "idle" });
    startTransition(async () => {
      const r = await retryDistrictLookup();
      if (r.ok) {
        setState({
          kind: "matched",
          cd: r.congressional_district,
          ssd: r.state_senate_district,
          shd: r.state_house_district,
        });
        setTimeout(() => router.refresh(), 700);
        return;
      }
      if (r.error === "no-match") {
        setState({ kind: "no-match" });
      } else if (r.error === "no-address") {
        setState({ kind: "error", message: "Add a street address first." });
      } else if (r.error === "rate-limited") {
        setState({ kind: "error", message: "Too many retries — wait a few minutes." });
      } else {
        setState({ kind: "error", message: r.error });
      }
    });
  }

  return (
    <div className={className}>
      {state.kind !== "matched" && (
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
        >
          {pending ? "Looking up…" : label}
        </button>
      )}
      {state.kind === "matched" && (
        <p className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-200">
          ✓ Matched! Loading your reps…
          {state.cd && <> US House <strong>{state.cd}</strong> ·</>}
          {state.ssd && <> State Sen. <strong>{state.ssd}</strong> ·</>}
          {state.shd && <> State Rep. <strong>{state.shd}</strong></>}
        </p>
      )}
      {state.kind === "no-match" && (
        <div className="mt-2 rounded-md border border-amber-700/40 bg-amber-950/15 p-3 text-[12px] text-amber-200">
          <p className="font-semibold">Address on file, but no Census match.</p>
          <p className="mt-1 text-amber-200/80">
            The US Census Bureau&apos;s address index doesn&apos;t cover every street (rural / unincorporated addresses sometimes get missed). You can still email your US senators directly — they represent the whole state.
          </p>
          {userState && (
            <a
              href={`/legislators?state=${userState}`}
              className="mt-2 inline-block rounded border border-amber-600/50 px-3 py-1 text-[11px] text-amber-200 hover:border-amber-400"
            >
              Find {userState} legislators manually →
            </a>
          )}
        </div>
      )}
      {state.kind === "error" && (
        <p className="mt-2 text-[12px] text-red-300">{state.message}</p>
      )}
    </div>
  );
}

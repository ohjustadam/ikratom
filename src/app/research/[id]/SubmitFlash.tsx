"use client";

import { useSearchParams } from "next/navigation";

/**
 * The one-time banner shown after a submission lands on /research/submit.
 *
 * Client-side since 2026-09-08: reading `?from=submit&duplicate=1` on the
 * SERVER made the whole paper page dynamic, so every crawler hit re-rendered
 * it against Supabase — to decide whether to show a banner that only ever
 * appears for the one person who just submitted something. The flags are pure
 * navigation state and belong in the browser.
 *
 * Renders nothing in the cached HTML, which is correct: the banner is not part
 * of the paper.
 */
export function SubmitFlash() {
  const sp = useSearchParams();
  if (sp.get("from") !== "submit") return null;
  const wasDuplicate = sp.get("duplicate") === "1";

  return (
    <div className={`mt-3 mb-4 rounded-md border-2 p-3 text-sm ${
      wasDuplicate
        ? "border-amber-700/50 bg-amber-950/15 text-amber-200"
        : "border-emerald-700/50 bg-emerald-950/15 text-emerald-200"
    }`}>
      {wasDuplicate ? (
        <>
          📚 This paper was already in the library. Taking you to its existing entry.
        </>
      ) : (
        <>
          ✓ Added to the library. Bibliographic metadata captured; topic tags + AI evaluation will populate after the next editorial pass. Thanks for contributing.
        </>
      )}
    </div>
  );
}

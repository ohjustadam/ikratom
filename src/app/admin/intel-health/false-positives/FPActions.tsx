"use client";

import { useState, useTransition } from "react";
import { unflagFP, deactivateFP } from "@/modules/news/admin-fp";

/**
 * Inline action buttons for each FP row. Live in a tiny client
 * component so the page itself stays a server component.
 *
 * Two actions:
 *   - Unflag: clear body_has_kratom_keyword back to NULL (item visible
 *     again). For Phase 1 over-flags / news-roundup rescues.
 *   - Deactivate: hard active=false. For permanently-bad data.
 *
 * Both record admin_audit_log entries server-side.
 */
export function FPActions({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState<null | "unflagged" | "deactivated" | "error">(null);
  const [errorMsg, setErrorMsg] = useState("");

  if (resolved === "unflagged") {
    return <span className="text-xs text-emerald-400">✓ unflagged · refresh to see</span>;
  }
  if (resolved === "deactivated") {
    return <span className="text-xs text-zinc-500">✓ deactivated</span>;
  }
  if (resolved === "error") {
    return <span className="text-xs text-red-400">✗ {errorMsg}</span>;
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const r = await unflagFP(id);
            if ("error" in r) {
              setResolved("error");
              setErrorMsg(r.error);
            } else {
              setResolved("unflagged");
            }
          });
        }}
        className="rounded border border-emerald-700/60 bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
        title="Unflag — clear body_has_kratom_keyword to NULL. Item becomes visible again. Records admin_audit_log."
      >
        unflag (not FP)
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("Permanently hide this item (active = false)? Records audit log.")) return;
          startTransition(async () => {
            const r = await deactivateFP(id);
            if ("error" in r) {
              setResolved("error");
              setErrorMsg(r.error);
            } else {
              setResolved("deactivated");
            }
          });
        }}
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-zinc-400 hover:border-red-700 hover:text-red-400 disabled:opacity-50"
        title="Permanently hide — sets active=false. For genuinely-bad data."
      >
        deactivate
      </button>
    </div>
  );
}

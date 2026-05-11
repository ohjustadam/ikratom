"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveDiscrepancy, forceResyncBill } from "@/modules/admin/discrepancy-actions";

type Discrepancy = {
  id: string;
  title: string;
  body: string | null;
  severity: string;
  locality: string;
  bill_id: string | null;
  created_at: string;
};

export function DiscrepancyRow({ discrepancy: d }: { discrepancy: Discrepancy }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resolve() {
    const note = prompt("Resolution note (what you fixed, or 'AI was wrong'):") ?? "";
    if (!note.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await resolveDiscrepancy({ alertId: d.id, note });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function forceSync() {
    if (!d.bill_id) {
      setError("No bill linked — can't force-sync");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await forceResyncBill({ billId: d.bill_id! });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <li
      className={`rounded-lg border p-4 ${
        d.severity === "critical"
          ? "border-red-700/50 bg-red-950/15"
          : "border-amber-700/40 bg-amber-950/10"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            d.severity === "critical"
              ? "bg-red-500 text-zinc-950"
              : "bg-amber-500 text-zinc-950"
          }`}
        >
          {d.severity}
        </span>
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {d.locality}
        </span>
        <span className="ml-auto text-[11px] text-zinc-500">
          {new Date(d.created_at).toLocaleString()}
        </span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug">{d.title}</h3>
      {d.body && (
        <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-900 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
{d.body}
        </pre>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {d.bill_id && (
          <a
            href={`/bills/${d.bill_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
          >
            View bill ↗
          </a>
        )}
        {d.bill_id && (
          <a
            href={`/admin/bills/${d.bill_id}/edit`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
          >
            Edit in admin ↗
          </a>
        )}
        {d.bill_id && (
          <button
            onClick={forceSync}
            disabled={pending}
            className="rounded-md border border-sky-700/40 bg-sky-950/20 px-3 py-1.5 text-xs text-sky-300 hover:border-sky-500 disabled:opacity-50"
          >
            ↻ Force re-sync next cron
          </button>
        )}
        <button
          onClick={resolve}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          ✓ Mark resolved
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-300">{error}</p>
      )}
    </li>
  );
}

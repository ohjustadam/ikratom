"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveIntelTip, rejectIntelTip } from "@/modules/alerts/actions";

const KIND_OPTIONS: { id: "bill_event" | "bop_hearing" | "fda_action" | "dea_action" | "ag_enforcement" | "news_break"; label: string }[] = [
  { id: "bill_event",     label: "Bill / ordinance" },
  { id: "bop_hearing",    label: "Pharmacy board" },
  { id: "ag_enforcement", label: "AG enforcement" },
  { id: "fda_action",     label: "FDA action" },
  { id: "dea_action",     label: "DEA action" },
  { id: "news_break",     label: "News break" },
];

const SEVERITY_OPTIONS: { id: "watch" | "alert" | "critical"; label: string }[] = [
  { id: "watch", label: "Watch" },
  { id: "alert", label: "Alert" },
  { id: "critical", label: "Critical" },
];

export function ModerateIntelRow({
  alertId,
  initialSeverity,
  initialActionRequired,
}: {
  alertId: string;
  initialSeverity: "watch" | "alert" | "critical";
  initialActionRequired: boolean;
}) {
  const router = useRouter();
  const [reassignKind, setReassignKind] = useState<typeof KIND_OPTIONS[number]["id"]>("bill_event");
  const [severity, setSeverity] = useState<typeof SEVERITY_OPTIONS[number]["id"]>(initialSeverity);
  const [actionRequired, setActionRequired] = useState(initialActionRequired);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function approve() {
    setError(null);
    startTransition(async () => {
      const r = await approveIntelTip({
        alertId,
        reassignKind,
        severity,
        actionRequired,
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function reject() {
    const note = prompt("Reason for rejection (audit log only — not sent to submitter):");
    if (!note) return;
    setError(null);
    startTransition(async () => {
      const r = await rejectIntelTip({ alertId, note });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Reassign kind
          </span>
          <select
            value={reassignKind}
            onChange={(e) => setReassignKind(e.target.value as typeof KIND_OPTIONS[number]["id"])}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Severity
          </span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof SEVERITY_OPTIONS[number]["id"])}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-end gap-2">
          <input
            type="checkbox"
            checked={actionRequired}
            onChange={(e) => setActionRequired(e.target.checked)}
            className="mb-1.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span className="pb-1.5 text-xs text-zinc-200">
            Action required (auto-spawn campaign)
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={approve}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "…" : "Approve + publish"}
        </button>
        <button
          onClick={reject}
          disabled={pending}
          className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
        >
          Reject
        </button>
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </div>
  );
}

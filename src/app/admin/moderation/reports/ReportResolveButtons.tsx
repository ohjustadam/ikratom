"use client";

import { useState, useTransition } from "react";
import { resolveContentReports } from "@/modules/reports/admin-actions";

export function ReportResolveButtons({ targetType, targetId }: { targetType: string; targetId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (d: "dismissed" | "actioned") =>
    start(async () => {
      const r = await resolveContentReports(targetType, targetId, d);
      setMsg("error" in r ? r.error : d === "actioned" ? "Marked handled." : "Dismissed.");
    });
  if (msg) return <p role="status" className="mt-2 text-xs text-emerald-400">{msg}</p>;
  return (
    <div className="mt-3 flex gap-2">
      <button type="button" disabled={pending} onClick={() => go("actioned")}
        className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Mark handled</button>
      <button type="button" disabled={pending} onClick={() => go("dismissed")}
        className="rounded-md border border-zinc-600 px-3 py-1 text-xs hover:border-zinc-400 disabled:opacity-50">Dismiss</button>
    </div>
  );
}

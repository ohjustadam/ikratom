"use client";

import { useState, useTransition } from "react";
import { resolvePhotoReport } from "@/modules/profile/photo-moderation-actions";

export function PhotoReportActions({ photoId }: { photoId: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const go = (d: "restore" | "remove") =>
    start(async () => {
      const r = await resolvePhotoReport(photoId, d);
      setMsg("error" in r ? r.error : d === "restore" ? "Restored." : "Removed.");
    });
  if (msg) return <p role="status" className="text-xs text-emerald-400">{msg}</p>;
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" disabled={pending} onClick={() => go("restore")}
        className="rounded-md border border-zinc-600 px-3 py-1 text-xs hover:border-emerald-500 disabled:opacity-50">Restore</button>
      <button type="button" disabled={pending} onClick={() => confirm("Delete this photo permanently?") && go("remove")}
        className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">Remove</button>
    </div>
  );
}

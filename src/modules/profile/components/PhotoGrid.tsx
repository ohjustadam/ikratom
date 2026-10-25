"use client";

import { useState } from "react";
import { ReportButton } from "@/modules/reports/components/ReportButton";

export type GridPhoto = { id: string; caption: string | null; width: number; height: number };

/**
 * A member's album as THIS viewer may see it (get_profile_photos already
 * filtered it). Tap a photo to open it; anyone signed in who is not the owner
 * can report it from there.
 */
export function PhotoGrid({ photos, canReport }: { photos: GridPhoto[]; canReport: boolean }) {
  const [open, setOpen] = useState<GridPhoto | null>(null);
  return (
    <>
      <ul className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {photos.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(p)} className="block aspect-square w-full overflow-hidden rounded-md bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element -- privacy route 302s to a signed URL */}
              <img src={`/api/media/${p.id}`} alt={p.caption ?? "Photo"} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setOpen(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${open.id}`} alt={open.caption ?? "Photo"} className="max-h-[75vh] w-full rounded-lg object-contain" />
            <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-sm text-zinc-200">
              <p className="min-w-0 flex-1 whitespace-pre-line">{open.caption}</p>
              <div className="flex items-center gap-3">
                {canReport && <ReportButton targetType="member_photo" targetId={open.id} />}
                <button type="button" onClick={() => setOpen(null)} className="rounded-md border border-zinc-600 px-3 py-1 text-xs">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

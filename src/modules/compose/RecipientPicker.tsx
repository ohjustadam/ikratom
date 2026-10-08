"use client";

import { useState } from "react";
import type { ComposeOfficial } from "./types";

/**
 * Choose who gets a group letter: everyone (default), a few, or one.
 * Owner ask 2026-10-03: "mass email all of them, or individually / a selected few".
 * Keyed by email so the parent can build To/BCC straight from the selection.
 */
export function RecipientPicker({
  officials, selected, onChange,
}: { officials: ComposeOfficial[]; selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const all = officials.filter((o) => o.email).map((o) => o.email!);
  const toggle = (email: string) => {
    const next = new Set(selected);
    if (next.has(email)) next.delete(email); else next.add(email);
    onChange(next);
  };
  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-zinc-300">
        <span>Recipients: <strong className="text-emerald-300">{selected.size}</strong> of {all.length} selected</span>
        <span className="text-zinc-500">{open ? "Hide ▲" : "Choose ▼"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <div className="mb-2 flex gap-3 text-[11px]">
            <button type="button" onClick={() => onChange(new Set(all))} className="text-emerald-400 hover:underline">Select all</button>
            <button type="button" onClick={() => onChange(new Set())} className="text-zinc-400 hover:underline">Select none</button>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {officials.filter((o) => o.email).map((o) => (
              <li key={o.email!}>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-200">
                  <input type="checkbox" checked={selected.has(o.email!)} onChange={() => toggle(o.email!)} className="accent-emerald-500" />
                  <span>{o.name}</span>
                  <span className="text-zinc-500">{o.title ?? o.role ?? ""}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

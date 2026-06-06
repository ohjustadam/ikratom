"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
];

/**
 * Self-serve controls for the public storefront kit. Personalizes the kit via
 * URL params (so the configured kit is shareable/bookmarkable), and triggers
 * the browser print dialog for the ready-to-print sheets.
 */
export function SpreadControls({ shop, state }: { shop: string; state: string }) {
  const router = useRouter();
  const [s, setS] = useState(shop);
  const [st, setSt] = useState(state);

  function apply() {
    const p = new URLSearchParams();
    if (s.trim()) p.set("shop", s.trim().slice(0, 60));
    if (st) p.set("state", st);
    const qs = p.toString();
    router.push(qs ? `/spread?${qs}` : "/spread");
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 sm:flex-row sm:items-end print:hidden">
      <label className="flex-1 text-xs text-zinc-400">
        Shop name <span className="text-zinc-600">(optional)</span>
        <input
          value={s}
          onChange={(e) => setS(e.target.value)}
          placeholder="e.g. Green Leaf Botanicals"
          maxLength={60}
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        />
      </label>
      <label className="text-xs text-zinc-400">
        State <span className="text-zinc-600">(optional)</span>
        <select
          value={st}
          onChange={(e) => setSt(e.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:w-28"
        >
          <option value="">All states</option>
          {STATES.map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={apply}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        Update kit
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        🖨 Print kit
      </button>
    </div>
  );
}

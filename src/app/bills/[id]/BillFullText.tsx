"use client";

import { useState } from "react";
import { AudioReader } from "@/components/AudioReader";

/**
 * Full bill text viewer — renders every captured version with a tab
 * selector. Lets readers compare introduced text against amended text
 * without leaving iKratom.
 *
 * Why client component: only the active-tab state is interactive;
 * everything else is server-rendered prose. This component holds the
 * tab state and renders the selected version's text + metadata.
 */
export type BillTextVersion = {
  label: string;
  date: string | null;
  text: string;
  source_url: string;
};

/**
 * Display-time cleanup of legislative-PDF artifacts (the raw text stays
 * untouched in the DB for search + classification):
 *  - line-number GUTTERS: state bill PDFs print 1..24 down the margin of
 *    every page; extraction emits them as number-only lines or long
 *    ascending integer runs ("1 2 3 … 24") — the issue the owner flagged.
 *  - page markers ("-- 2 of 3 --") and "Req. No. … Page N" headers.
 */
function cleanBillText(t: string): string {
  let s = t
    .replace(/--\s*\d+\s+of\s+\d+\s*--/g, "\n")
    .replace(/^\s*\d{1,2}\s*$/gm, ""); // number-only gutter lines
  // Inline ascending integer runs of length >= 4 (single-spaced extracts)
  s = s.replace(/(?:\b\d{1,2}\b\s+){4,}/g, (m) => {
    const nums = m.trim().split(/\s+/).map(Number);
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] !== nums[i - 1] + 1) return m; // not a gutter — keep
    }
    return " ";
  });
  return s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

export function BillFullText({ versions }: { versions: BillTextVersion[] }) {
  // Default to the LATEST version (last in the array — that's how the
  // enrich script orders them, chronological).
  const [activeIdx, setActiveIdx] = useState(versions.length - 1);
  const active = versions[activeIdx];
  if (!active) return null;

  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Full bill text
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">
          {versions.length} version{versions.length === 1 ? "" : "s"} archived
        </span>
      </div>

      {/* Version selector — horizontal scrolling tab strip */}
      <div className="-mx-1 mb-3 flex flex-wrap gap-1.5">
        {versions.map((v, i) => {
          const isActive = i === activeIdx;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                isActive
                  ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-600"
              }`}
              title={v.date ? `Filed ${v.date}` : undefined}
            >
              <span className="font-mono">{v.label}</span>
              {v.date && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  {v.date}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active version metadata + read-aloud (reads the cleaned statute text
          of the selected version; re-keyed so switching versions resets it). */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <span>{active.text.length.toLocaleString()} characters</span>
        <a
          href={active.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-emerald-400 hover:underline"
        >
          ↗ Open original PDF
        </a>
        <AudioReader
          key={activeIdx}
          id={`billtext-${activeIdx}`}
          text={cleanBillText(active.text)}
          label="Listen to this version"
          compact
        />
      </div>

      {/* Text body — monospace, scrollable, max-height capped so the
          page doesn't become an endless scroll. Reader can expand if
          they want to read the whole thing inline. */}
      <details className="group" open={active.text.length < 4000}>
        <summary className="cursor-pointer list-none rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-400 hover:border-emerald-700/60 group-open:hidden">
          Show full text ({active.text.length.toLocaleString()} chars) ▾
        </summary>
        <div className="mt-2 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-300">
            {cleanBillText(active.text)}
          </pre>
        </div>
        <button
          type="button"
          onClick={(e) => (e.currentTarget.closest("details") as HTMLDetailsElement).open = false}
          className="mt-2 text-[11px] text-zinc-500 hover:text-emerald-400 group-open:inline hidden"
        >
          ▴ Collapse
        </button>
      </details>
    </section>
  );
}

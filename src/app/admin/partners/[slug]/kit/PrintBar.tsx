"use client";

/**
 * Floating top bar on the print kit page. Hidden via @media print so it
 * doesn't show up on the printed sheets — only visible on screen.
 *
 * Two affordances:
 *   1. Click "Print" to open the browser's print dialog. The user picks
 *      "Save as PDF" or sends to a real printer.
 *   2. Copy the QR target URL — useful for a quick paste into a
 *      separate web tool if the partner has their own design assets.
 */

import { useState } from "react";

export function PrintBar({ partnerName, qrUrl }: { partnerName: string; qrUrl: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(qrUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
        <a href="/admin/partners" className="text-xs text-zinc-500 hover:text-emerald-400">
          ← Partners
        </a>
        <span className="text-sm font-semibold text-zinc-100">Kit for {partnerName}</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={copy}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
          >
            {copied ? "Copied!" : "Copy QR URL"}
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Print → save PDF
          </button>
        </span>
      </div>
      <p className="mx-auto mt-1 max-w-4xl text-xs text-zinc-500">
        Below: 4 sheets, each on its own page. Print to PDF, drop the file on a
        USB drive, hand to the shop. The kit re-renders with the latest site
        messaging every time you reload — no stale assets.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";

/**
 * Prominent "Sync to your calendar" CTA for /calendar.
 *
 * The .ics subscribe feed already existed but was buried in a small header
 * panel nobody noticed. This surfaces it as an eye-catching gradient button
 * that opens a polished popover with the three subscribe paths (Apple/Outlook
 * via webcal://, Google via add-by-URL, raw .ics download) + a copy-link row
 * with feedback. All URLs are computed server-side and passed in as props so
 * the current state/kind filter carries through to the subscription.
 */
export function CalendarSyncButton({
  httpsUrl,
  webcalUrl,
  googleUrl,
  scopeLabel,
}: {
  httpsUrl: string;
  webcalUrl: string;
  googleUrl: string;
  scopeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the URL is still visible to select manually */
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 transition hover:from-emerald-300 hover:to-teal-300 hover:shadow-emerald-400/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-900/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-zinc-900" />
        </span>
        📅 Sync to your calendar
        <svg
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Subscribe to the calendar"
            className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-emerald-700/40 bg-zinc-950/95 shadow-2xl shadow-black/50 backdrop-blur"
          >
            <div className="bg-gradient-to-r from-emerald-500/20 to-teal-500/20 px-4 py-3">
              <p className="text-sm font-bold text-emerald-200">Never miss a kratom event</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                Subscribe once — <strong className="text-zinc-200">{scopeLabel}</strong> lands on your phone &amp; computer and auto-refreshes.
              </p>
            </div>

            <div className="space-y-1.5 p-3">
              <SyncOption
                href={webcalUrl}
                icon="🍎"
                label="Apple Calendar / Outlook"
                sub="One tap — opens a subscribe prompt"
                primary
              />
              <SyncOption
                href={googleUrl}
                icon="🗓️"
                label="Google Calendar"
                sub="Add by URL"
                external
              />
              <SyncOption
                href={httpsUrl}
                icon="⬇️"
                label="Download .ics file"
                sub="Import into any calendar app"
                download="ikratom.ics"
              />
            </div>

            <div className="border-t border-zinc-800 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Or copy the feed URL</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-zinc-900 px-2 py-1.5 font-mono text-[10px] text-zinc-400">
                  {httpsUrl}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-semibold transition ${
                    copied ? "bg-emerald-600 text-zinc-950" : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500"
                  }`}
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>

            <p className="bg-zinc-900/60 px-3 py-2 text-[10px] text-zinc-500">
              🔄 Refreshes every 6 hours — new events appear automatically.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function SyncOption({
  href, icon, label, sub, primary, external, download,
}: {
  href: string; icon: string; label: string; sub: string;
  primary?: boolean; external?: boolean; download?: string;
}) {
  return (
    <a
      href={href}
      download={download}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition ${
        primary
          ? "border-emerald-600/50 bg-emerald-950/30 hover:border-emerald-400 hover:bg-emerald-950/50"
          : "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500/60 hover:bg-zinc-900"
      }`}
    >
      <span className="text-lg leading-none">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-zinc-100">{label}</span>
        <span className="block text-[10px] text-zinc-500">{sub}</span>
      </span>
      <span className="ml-auto text-zinc-600">→</span>
    </a>
  );
}

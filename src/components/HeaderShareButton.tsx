"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Header share button — sits next to the user avatar / sign-in pill.
 * On click, opens a popup with QuickShareModal contents (passed as
 * children so the server component can pre-render the user's invite
 * URL or generic links).
 *
 * Keyboard: Escape to close. Click outside to close.
 */
export function HeaderShareButton({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!modalRef.current) return;
      if (!modalRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("keydown", onKey);
      document.addEventListener("mousedown", onClick);
      // Lock body scroll while modal open
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("mousedown", onClick);
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share iKratom"
        title="Share"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
      >
        {/* Inline icon — avoids extra HTTP request for an SVG file. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 py-12 backdrop-blur-sm">
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Share iKratom"
            className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-100">Share iKratom</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close share dialog"
                className="rounded p-1 text-zinc-500 hover:text-zinc-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>
            <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

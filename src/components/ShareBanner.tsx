"use client";

import { useEffect, useState } from "react";

/**
 * Slim, dismissible site-wide note nudging users to share iKratom links
 * (not the original source) while we build every story into a full,
 * listenable in-app page — so our links work as the source/citation.
 *
 * Dismissal persists in localStorage. Bump STORAGE_KEY's version suffix to
 * re-show it after a material change in messaging.
 */
const STORAGE_KEY = "ikratom-share-banner-dismissed-v1";

export default function ShareBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== "1") setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-emerald-800/40 bg-emerald-950/30 px-4 py-2 text-center text-xs text-emerald-200">
      <span>
        📣 Spreading the word? Share <strong>iKratom links</strong> — we&apos;re building every story into a full,
        listenable page right here, so our links work as the source.
      </span>
      <button
        type="button"
        onClick={() => {
          try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
          setShow(false);
        }}
        className="shrink-0 rounded px-1.5 text-emerald-400/70 transition hover:text-emerald-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

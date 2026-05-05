"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ik_cookie_ack_v1";

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      // localStorage unavailable — quietly skip
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {}
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <p className="flex-1 text-xs text-zinc-300">
          🍪 We use 2 essential cookies to keep you signed in. <strong>No tracking, no ads, no third-party analytics.</strong>{" "}
          <a href="/cookies" className="text-emerald-400 hover:underline">Cookie policy</a>
          {" · "}
          <a href="/privacy" className="text-emerald-400 hover:underline">Privacy</a>
        </p>
        <button
          onClick={dismiss}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

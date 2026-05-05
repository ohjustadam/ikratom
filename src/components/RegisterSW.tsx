"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js once the page loads. Production-only — the dev server
 * caches Next.js HMR chunks aggressively, so a SW would constantly serve
 * stale assets in dev.
 */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Service worker registration failures are non-fatal — the app still works
          console.warn("[sw] registration failed:", err);
        });
    };

    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });

    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}

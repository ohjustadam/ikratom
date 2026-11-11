"use client";

import { useEffect } from "react";
import { attributionToCapture } from "@/lib/attribution-landing";

/**
 * Captures attribution params from the landing URL and asks the server to
 * persist them as httpOnly cookies.
 *
 * Replaces the capture that lived in `proxy.ts` (disabled on Netlify — Next 16
 * middleware can't be edge-bundled). Without this, `embed_ref` and `invite_ref`
 * are never written, so partner-widget actions and invite signups go
 * uncredited: `campaigns/actions.ts` and `auth/actions.ts` both read cookies
 * that nothing was setting.
 *
 * Runs in the root layout, but only does anything when the URL actually carries
 * one of the params — so the overwhelming majority of page loads make **zero**
 * network calls. It stays a client island deliberately: reading the URL on the
 * server would require a dynamic render, which is exactly what we removed to
 * fix the CPU overage.
 *
 * The cookie VALUES are set server-side and stay httpOnly, same as before; this
 * only reports which params were seen.
 */
export function AttributionCapture() {
  useEffect(() => {
    let cancelled = false;
    try {
      // Nothing to attribute, or a `?state=` filter link clicked on our own
      // site: the common cases. Don't touch the network (attribution-landing).
      const params = attributionToCapture(window.location.search, document.referrer, window.location.origin);
      if (!params) return;
      const { ref, host, state, via } = params;

      // Once per landing. Without this guard a client-side navigation that
      // preserves the query string would re-POST and keep refreshing the TTL.
      const seen = sessionStorage.getItem("ik-attr");
      const sig = `${ref ?? ""}|${host ?? ""}|${state ?? ""}|${via ?? ""}`;
      if (seen === sig) return;

      fetch("/api/attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ref, host, state, via }),
        keepalive: true,
      })
        .then(() => {
          if (!cancelled) {
            try { sessionStorage.setItem("ik-attr", sig); } catch { /* private mode */ }
          }
        })
        .catch(() => { /* attribution is best-effort; never break the page */ });
    } catch {
      /* malformed URL / storage blocked — attribution is never load-bearing */
    }
    return () => { cancelled = true; };
  }, []);

  return null;
}

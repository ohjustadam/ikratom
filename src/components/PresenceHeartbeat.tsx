"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// "Who's online" counts the last 5 minutes, so a ping every 4 is enough. It was
// every 60 s, and each ping wakes the paid server function (2026-10-07).
const EVERY_MS = 4 * 60_000;
const GIVE_UP_AFTER = 3; // consecutive failures, then stop for this page view

/**
 * Presence heartbeat for signed-in members: on mount, when the tab becomes
 * visible again, and every 4 minutes while visible. Calls the touch_last_seen
 * RPC directly, which survives deploys (a server action did not). The
 * /api/presence route stays for tabs opened before this change.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let failures = 0;
    let lastSent = 0;
    const ping = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (Date.now() - lastSent < 30_000) return; // a tab switch storm is one ping
      lastSent = Date.now();
      // Straight to Supabase, not through /api/presence: that route woke a paid
      // Netlify function (~0.76 s) every 4 minutes for every open member tab,
      // the site's most frequent member-made request (2026-11-17 scale audit).
      // Same RPC, same JWT, same self-throttle; it no-ops when signed out.
      Promise.resolve(supabase.rpc("touch_last_seen"))
        .then(({ error }) => { failures = error ? failures + 1 : 0; })
        .catch(() => { failures += 1; })
        .finally(() => { if (failures >= GIVE_UP_AFTER) stop(); });
    };
    const id = setInterval(ping, EVERY_MS);
    const stop = () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
    ping();
    document.addEventListener("visibilitychange", ping);
    return stop;
  }, []);
  return null;
}

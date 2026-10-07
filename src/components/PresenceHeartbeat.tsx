"use client";

import { useEffect } from "react";

// "Who's online" counts the last 5 minutes, so a ping every 4 is enough. It was
// every 60 s, and each ping wakes the paid server function (2026-10-07).
const EVERY_MS = 4 * 60_000;
const GIVE_UP_AFTER = 3; // consecutive failures, then stop for this page view

/**
 * Presence heartbeat for signed-in members: on mount, when the tab becomes
 * visible again, and every 4 minutes while visible. Uses POST /api/presence,
 * which survives deploys (a server action did not — see the route).
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let lastSent = 0;
    const ping = () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (Date.now() - lastSent < 30_000) return; // a tab switch storm is one ping
      lastSent = Date.now();
      fetch("/api/presence", { method: "POST", keepalive: true })
        .then((r) => { failures = r.ok ? 0 : failures + 1; })
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

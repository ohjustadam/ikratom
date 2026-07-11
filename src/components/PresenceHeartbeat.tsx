"use client";

import { useEffect } from "react";
import { heartbeat } from "@/modules/presence/actions";

/**
 * Fires a presence heartbeat on mount and every 60s while the tab is visible,
 * so the owner's "who's online" view stays current. Mounted in the root layout
 * for signed-in users only. Cheap: the server RPC self-throttles writes.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    let stopped = false;
    const ping = () => {
      if (!stopped && document.visibilityState === "visible") void heartbeat();
    };
    ping();
    const id = setInterval(ping, 60_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);
  return null;
}

"use client";

import { useEffect, useState } from "react";

/**
 * False once the tab has been in the background for `graceMs`, true again as
 * soon as it is visible. The Lounge uses it to let go of its realtime socket
 * when a member leaves the chat open in a tab they aren't looking at; a quick
 * glance at another tab keeps the connection.
 */
export function useTabAwake(graceMs = 60_000) {
  const [awake, setAwake] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        timer = null;
        setAwake(true);
      } else if (!timer) {
        timer = setTimeout(() => { timer = null; setAwake(false); }, graceMs);
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      if (timer) clearTimeout(timer);
    };
  }, [graceMs]);

  return awake;
}

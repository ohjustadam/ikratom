"use client";

import { useEffect, useState } from "react";

/** Becomes true (and stays true) the first time `eventName` fires on window. */
export function useEventFlag(eventName: string) {
  const [fired, setFired] = useState(false);
  useEffect(() => {
    const on = () => setFired(true);
    window.addEventListener(eventName, on);
    return () => window.removeEventListener(eventName, on);
  }, [eventName]);
  return fired;
}

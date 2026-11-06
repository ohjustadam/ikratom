"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/** Fired when the member has seen the Lounge, so the floating badge clears at once. */
export const LOUNGE_SEEN_EVENT = "ikratom:lounge-seen";

const MARK_DELAY_MS = 2000;

/**
 * Keeps the Lounge badge honest while the member is looking at the chat.
 *
 * Marking only when the chat first opened left every message that arrived while
 * it was open counted as unread on the next page load, and the full Lounge on
 * /forum never marked anything at all, so the number never went away. Now the
 * member stays caught up for as long as the chat is on screen, in the popup or
 * on the page, and once more as they leave it.
 *
 * At most one write every couple of seconds however busy the room is. A chat
 * left open in a background tab doesn't count as seen.
 */
export function useLoungeSeen(active: boolean, messageCount: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      markSeen();
    }, MARK_DELAY_MS);
  }, [active, messageCount]);

  useEffect(() => {
    if (!active) return;
    const onVisible = () => markSeen();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      markSeen();
    };
  }, [active]);
}

function markSeen() {
  if (document.visibilityState !== "visible") return;
  void createClient().rpc("mark_lounge_seen");
  window.dispatchEvent(new Event(LOUNGE_SEEN_EVENT));
}

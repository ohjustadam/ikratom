"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const OPEN_KEY = "ikratom:lounge:open";

/**
 * Whether the floating Lounge is open.
 *
 *   - "Keep chat open when I change pages" ON: it stays open as the member
 *     moves around the site, and comes back open after a full page load.
 *   - OFF (the default): moving to another page closes it, so it never sits
 *     on top of the page someone just asked for.
 *
 * Also opens it from a mention notification (/?lounge=<message id>) or the
 * homepage community strip ("ikratom:open-lounge"). Read from window, not
 * useSearchParams, so the static layout stays static.
 */
export function useLoungeOpen(keepOpen: boolean, prefsReady: boolean) {
  const pathname = usePathname();
  const [open, setOpenState] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const lastPath = useRef(pathname);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    try {
      if (v) localStorage.setItem(OPEN_KEY, "1");
      else localStorage.removeItem(OPEN_KEY);
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lounge");
    if (id) {
      setOpen(true);
      if (/^[0-9a-f-]{36}$/i.test(id)) setHighlightId(id);
      const url = new URL(window.location.href);
      url.searchParams.delete("lounge");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("ikratom:open-lounge", onOpen);
    return () => window.removeEventListener("ikratom:open-lounge", onOpen);
  }, [setOpen]);

  // After a full page load, reopen it for a member who keeps it open.
  useEffect(() => {
    if (!prefsReady || !keepOpen) return;
    try { if (localStorage.getItem(OPEN_KEY) === "1") setOpenState(true); } catch { /* private mode */ }
  }, [prefsReady, keepOpen]);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (!keepOpen) setOpen(false);
  }, [pathname, keepOpen, setOpen]);

  return { open, setOpen, highlightId };
}

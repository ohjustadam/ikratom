"use client";

import { useEffect } from "react";

/**
 * Push-notification landing redirect.
 *
 * When a push is tapped and the PWA isn't already open, the service worker
 * opens the public app home (`/?ikto=<target>`) as the FIRST (root) history
 * entry instead of opening the deep target directly. This component then does
 * a full (cross-document) navigation to that target.
 *
 * Why a real navigation and NOT router.push / history.pushState:
 * Chromium's "History Manipulation Intervention" flags every *same-document*
 * history entry added without a user activation as skip-on-back — and a
 * push-opened window carries no user activation. A same-document push (which
 * is what router.push does) would let the Android system back button skip
 * straight past the root, exhaust the stack, and background the standalone PWA
 * (the "back minimizes the app instead of navigating" bug). Two separate
 * document loads (home, then target) each get a normal, non-skippable initial
 * entry, so the first back reliably lands on the app home in-app; a second
 * back backgrounds the app, as expected. See Chromium's
 * history_manipulation_intervention.md for the exact skip rule.
 */
export function PushBackStop() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const to = url.searchParams.get("ikto");
    if (!to) return;

    // Strip the marker off the hub entry (replaceState adds no history entry)
    // so that a later back to the hub — a fresh reload — doesn't bounce to the
    // target again.
    url.searchParams.delete("ikto");
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );

    // Same-origin internal paths only — never an open redirect.
    if (!to.startsWith("/")) return;
    let target: URL;
    try {
      target = new URL(to, window.location.origin);
    } catch {
      return;
    }
    if (target.origin !== window.location.origin) return;

    // Already where we need to be (e.g. the link was /notifications itself).
    if (target.pathname === url.pathname && target.search === url.search) return;

    window.location.assign(target.pathname + target.search + target.hash);
  }, []);

  return null;
}

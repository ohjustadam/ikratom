"use client";

import { useEffect } from "react";

/**
 * When a push-notification tap opens the PWA via clients.openWindow, the
 * window starts with a one-entry history stack — on Android the system
 * back button then closes the app outright instead of going anywhere.
 * The service worker tags those opens with ?ikfrom=push; here we splice
 * /notifications underneath the current entry so back lands on the
 * notification hub, then strip the marker from the address bar.
 */
export function PushBackStop() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("ikfrom") !== "push") return;
    url.searchParams.delete("ikfrom");
    const clean = url.pathname + url.search + url.hash;
    if (window.history.length <= 1 && url.pathname !== "/notifications") {
      window.history.replaceState(null, "", "/notifications");
      window.history.pushState(null, "", clean);
    } else {
      window.history.replaceState(null, "", clean);
    }
  }, []);
  return null;
}

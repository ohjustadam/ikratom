/**
 * Client-side push-environment detection (safe to import in "use client"
 * components only).
 *
 * Why this exists: the Tauri desktop .exe runs on Windows WebView2, which
 * exposes the Notification/PushManager interfaces but supports NEITHER web
 * push nor a permission UI — permission reads "denied" forever and there is
 * no 🔒 address-bar icon to click. The old copy told .exe users to fix a
 * browser setting that doesn't exist (owner hit this on day one). Detection:
 *  - window.__TAURI__ — present in desktop builds ≥ v1.0.1 (withGlobalTauri)
 *  - older v1.0.0 .exe can't be detected reliably, so the generic blocked
 *    message also carries the desktop hint.
 */
export function isDesktopShell(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI__" in window;
}

export const DESKTOP_SHELL_PUSH_MSG =
  "You're using the iKratom desktop program (.exe), which can't receive push " +
  "notifications yet — the embedded Windows WebView doesn't support web push. " +
  "For desktop push, install the one-click app instead: open ikratom.org/install/windows " +
  "in Chrome or Edge. Same app, push works, no download needed.";

/** Blocked-permission message that is honest in every environment. */
export function pushBlockedMessage(): string {
  if (isDesktopShell()) return DESKTOP_SHELL_PUSH_MSG;
  return (
    "Notifications are blocked for this site. Click the 🔒 (or notification) icon in your " +
    "browser's address bar, find 'Notifications', change it to 'Allow', then reload this page. " +
    "(Using the iKratom desktop program? It can't receive push yet — for desktop push, install " +
    "the one-click app at ikratom.org/install/windows in Chrome or Edge.)"
  );
}

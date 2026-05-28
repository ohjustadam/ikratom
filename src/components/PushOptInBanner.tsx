"use client";

import { useEffect, useState, useTransition } from "react";
import { savePushSubscription } from "@/modules/auth/actions-push";

/**
 * Dashboard banner that surfaces the push opt-in to EXISTING users
 * who didn't see the new onboarding push step.
 *
 * Server passes:
 *   - hasSubscriptions: did this user already register a push subscription?
 *   - vapidPublicKey: env value for the subscribe call
 *   - userState: render "alerts in {state}" copy
 *
 * Banner is hidden when:
 *   - user already has a push subscription (server-detected)
 *   - browser doesn't support push (feature-detected client-side)
 *   - user clicks dismiss → stored in localStorage with 14-day TTL
 *
 * Same VAPID subscribe flow as src/modules/auth/components/PushSubscribe
 * — duplicated logic kept inline here so a single tap on the banner
 * does the whole opt-in without a page hop.
 */

const DISMISS_KEY = "ikratom:push-banner-dismissed-at";
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

// iOS Safari requires PWA install before Push API becomes available.
// Detect that case so the banner routes users to /install/ios instead
// of attempting a subscribe that will silently fail.
function detectIosNeedsInstall(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
  if (!isIos) return false;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

export function PushOptInBanner({
  hasSubscriptions,
  vapidPublicKey,
  userState,
}: {
  hasSubscriptions: boolean;
  vapidPublicKey: string | null;
  userState: string | null;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [subscribed, setSubscribed] = useState(hasSubscriptions);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIosNeedsInstall(detectIosNeedsInstall());
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);

    // Check 14-day dismissal cooldown
    try {
      const dismissedAt = localStorage.getItem(DISMISS_KEY);
      if (dismissedAt) {
        const elapsed = Date.now() - Number(dismissedAt);
        if (elapsed < DISMISS_TTL_MS) setDismissed(true);
      }
    } catch { /* localStorage may be blocked */ }

    // Also confirm browser-level subscription state in case server DB and
    // browser are out of sync (e.g. user revoked permission in browser
    // settings without unsubscribing in app)
    if (ok && hasSubscriptions) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (!sub) setSubscribed(false);   // server says yes, browser says no — show banner anyway
        })
        .catch(() => { /* ignore */ });
    }
  }, [hasSubscriptions]);

  async function enable() {
    setError(null);
    if (!vapidPublicKey) {
      setError("Push notifications aren't configured on this server yet.");
      return;
    }
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "denied") {
      // Permission was previously denied at the browser level. We can't
      // re-prompt — user has to manually fix in browser settings. Give
      // specific instructions per browser since the URL bar icon varies.
      setError(
        "Notifications are blocked for this site. Click the 🔒 (or notification) icon in your browser's address bar, " +
        "find 'Notifications', change it to 'Allow', then reload this page. " +
        "On Chrome: chrome://settings/content/notifications. On Firefox: about:preferences#privacy."
      );
      return;
    }
    if (Notification.permission !== "granted") {
      const r = await Notification.requestPermission();
      if (r === "denied") {
        setError(
          "You blocked the notification prompt. To re-enable: click the 🔒 icon in your browser's address bar, " +
          "find 'Notifications', change it to 'Allow', then reload."
        );
        return;
      }
      if (r !== "granted") {
        setError("Permission prompt dismissed. Click 'Enable alerts' again and choose 'Allow' on the popup.");
        return;
      }
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      startTransition(async () => {
        const r = await savePushSubscription({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          userAgent: navigator.userAgent,
          origin: window.location.origin,
        });
        if ("error" in r) setError(r.error ?? "Failed to save subscription");
        else setSubscribed(true);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* */ }
  }

  // Hide if already subscribed (server-confirmed), dismissed in last 14d,
  // or we haven't yet feature-detected. Note: iOS-needs-install case
  // is NOT hidden — we want to nudge those users to install the PWA.
  if (subscribed || supported === null || dismissed) return null;
  // If neither installed-iOS-PWA NOR a supporting browser, hide.
  if (!supported && !iosNeedsInstall) return null;

  const stateLabel = userState ?? "your state";

  // iOS-on-Safari (not installed): route to /install/ios instead of
  // attempting a doomed subscribe. Same red-accent CTA, different action.
  if (iosNeedsInstall) {
    return (
      <section className="rounded-lg border border-red-700/40 bg-red-950/15 p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl">📱</span>
          <div className="flex-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">
              Get critical kratom alerts on your iPhone
            </h2>
            <p className="mt-1 text-sm text-zinc-200">
              On iOS you need to install iKratom to your home screen first
              (Apple&apos;s rule). 30 seconds, free, no app store. Then push
              notifications for {stateLabel} hearings, bill events, and live
              meetings start working immediately.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/install/ios"
                className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-bold text-zinc-950 hover:bg-emerald-400"
              >
                📲 Show me how →
              </a>
              <button
                type="button"
                onClick={dismiss}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-red-700/40 bg-red-950/15 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-2xl">🔔</span>
        <div className="flex-1">
          <h2 className="text-sm font-bold uppercase tracking-wider text-red-300">
            Enable critical kratom alerts for {stateLabel}
          </h2>
          <p className="mt-1 text-sm text-zinc-200">
            Live meeting broadcasts · 7d / 3d / 1d hearing reminders · DEA + AG
            + bill-signing alerts the moment they happen.
            We only push state-filtered alerts — no noise.
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            🔒 Delivered via your browser&apos;s built-in push. We never see
            what you do after. Disable anytime in /account/security.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={enable}
              disabled={pending}
              className="rounded bg-emerald-500 px-4 py-1.5 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {pending ? "Enabling…" : "🔔 Enable alerts"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              Maybe later
            </button>
          </div>
          {error && (
            <p className="mt-2 rounded border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

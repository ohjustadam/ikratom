"use client";

import { useEffect, useState, useTransition } from "react";
import { savePushSubscription, deletePushSubscription } from "../actions-push";
import { isDesktopShell, pushBlockedMessage, DESKTOP_SHELL_PUSH_MSG } from "@/lib/push/client-support";

/**
 * Browser-side push opt-in. Shows three states:
 *   1. Browser doesn't support Push API — explain
 *   2. VAPID key not configured on server — explain (button disabled)
 *   3. Ready — show toggle
 */

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// iOS Safari requires the user to install the PWA to home screen
// BEFORE Push API becomes available. Detecting "iOS Safari that hasn't
// been installed yet" lets us show install instructions instead of a
// dead-end "your browser doesn't support web push" message.
function detectIosNeedsInstall(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
  if (!isIos) return false;
  // Already running as a standalone PWA? Push works there.
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

export function PushSubscribe({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIosNeedsInstall(detectIosNeedsInstall());
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => { /* ignore */ });
  }, []);

  async function subscribe() {
    setError(null);
    if (!vapidPublicKey) {
      setError("Push notifications require server VAPID keys. Owner needs to set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in env.");
      return;
    }
    if (isDesktopShell()) {
      setError(DESKTOP_SHELL_PUSH_MSG);
      return;
    }
    if (Notification.permission === "denied") {
      setError(pushBlockedMessage());
      return;
    }
    if (Notification.permission !== "granted") {
      const r = await Notification.requestPermission();
      if (r === "denied") {
        setError(pushBlockedMessage());
        return;
      }
      if (r !== "granted") {
        setError("Permission prompt dismissed. Click 'Enable' again and choose 'Allow' on the popup.");
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
        if ("error" in r) setError(r.error ?? "Failed");
        else setSubscribed(true);
      });
      void arrayBufferToBase64Url; // silence unused-helper lint in ESM
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function unsubscribe() {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) { setSubscribed(false); return; }
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      startTransition(async () => {
        await deletePushSubscription(endpoint);
        setSubscribed(false);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (supported === null) return null;

  // iOS Safari needs the PWA installed to home screen before Push API
  // becomes available. Surface the install path instead of a dead-end.
  if (iosNeedsInstall) {
    return (
      <div className="rounded-md border border-emerald-700/40 bg-emerald-950/15 p-4">
        <p className="text-sm font-semibold text-emerald-200">
          📱 iOS needs one extra step
        </p>
        <p className="mt-1 text-xs text-zinc-300">
          Push notifications only work on iPhone/iPad after you install iKratom
          to your home screen — Apple&apos;s requirement, not ours.
          Tap the Share icon in Safari, then &ldquo;Add to Home Screen&rdquo;.
          Open iKratom from the home-screen icon, sign in again, and the
          push button will appear.
        </p>
        <a
          href="/install/ios"
          className="mt-3 inline-block rounded bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400"
        >
          📲 Show me how to install →
        </a>
      </div>
    );
  }

  if (!supported) {
    return (
      <p className="text-xs text-zinc-500">
        Your browser doesn&apos;t support web push. Try Chrome, Firefox, or Edge —
        or on iOS, install iKratom to your home screen first via Safari.
      </p>
    );
  }

  return (
    <div>
      {!vapidPublicKey ? (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-xs text-amber-200">
          ⚠ Push notifications require server VAPID keys. Owner must set
          <code className="mx-1 rounded bg-zinc-950 px-1 text-emerald-300">NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>
          + <code className="mx-1 rounded bg-zinc-950 px-1 text-emerald-300">VAPID_PRIVATE_KEY</code>
          in Vercel env. See SECURITY.md for setup.
        </div>
      ) : subscribed ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-emerald-300">✓ Push notifications enabled</span>
          <button
            onClick={unsubscribe}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-red-700 hover:text-red-300 disabled:opacity-50"
          >
            Disable
          </button>
        </div>
      ) : (
        <button
          onClick={subscribe}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Subscribing…" : "Enable push notifications"}
        </button>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

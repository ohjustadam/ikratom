"use client";

import { useEffect, useState, useTransition } from "react";
import { savePushSubscription, deletePushSubscription } from "../actions-push";

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

export function PushSubscribe({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
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
    if (Notification.permission === "denied") {
      setError("Notifications are blocked for this site. Update browser site settings to allow.");
      return;
    }
    if (Notification.permission !== "granted") {
      const r = await Notification.requestPermission();
      if (r !== "granted") {
        setError("Permission denied.");
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

  if (!supported) {
    return (
      <p className="text-xs text-zinc-500">
        Your browser doesn&apos;t support web push. (iOS Safari requires installing
        as a PWA via Add to Home Screen first.)
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

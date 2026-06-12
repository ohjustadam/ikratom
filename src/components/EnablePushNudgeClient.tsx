"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { savePushSubscription } from "@/modules/auth/actions-push";
import { isDesktopShell, pushBlockedMessage, DESKTOP_SHELL_PUSH_MSG } from "@/lib/push/client-support";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

// iOS Safari without installed PWA can't subscribe — same detection as
// PushSubscribe.tsx + PushOptInBanner.tsx from prior PRs.
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

/**
 * Inline push-enable nudge for signed-in users without subscriptions.
 * Server component (EnablePushNudge) gates whether this renders;
 * client component handles the actual subscribe flow.
 */
export function EnablePushNudgeClient({
  headline,
  sub,
  vapidPublicKey,
  className,
}: {
  headline: string;
  sub: string;
  vapidPublicKey: string;
  className?: string;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIosNeedsInstall(detectIosNeedsInstall());
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    // Re-check actual browser subscription state — server says we have
    // none but the user might have just subscribed in another tab.
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (sub) setSubscribed(true); })
      .catch(() => { /* */ });
  }, []);

  async function enable() {
    setError(null);
    if (typeof Notification === "undefined") return;
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
        setError("Prompt dismissed. Click the button again.");
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

  // Don't render if: subscribed, unsupported, or pre-mount (avoid flash)
  if (subscribed || supported === null) return null;
  if (!supported && !iosNeedsInstall) return null;

  // iOS-not-installed case → route to /install/ios instead of trying to subscribe
  if (iosNeedsInstall) {
    return (
      <section className={`rounded-lg border border-red-700/40 bg-red-950/15 p-4 ${className ?? ""}`}>
        <p className="text-sm font-bold text-red-300">📱 iPhone needs install first</p>
        <p className="mt-1 text-xs text-zinc-300">
          On iOS, push notifications need iKratom installed to your home screen first. 30 seconds, free, no app store.
        </p>
        <Link
          href="/install/ios"
          className="mt-2 inline-block rounded bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400"
        >
          📲 Install to home screen →
        </Link>
      </section>
    );
  }

  return (
    <section className={`rounded-lg border border-red-700/40 bg-red-950/15 p-4 ${className ?? ""}`}>
      <p className="text-sm font-bold text-red-200">{headline}</p>
      <p className="mt-1 text-xs text-zinc-300">{sub}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={enable}
          disabled={pending}
          className="rounded bg-emerald-500 px-4 py-1.5 text-xs font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Enabling…" : "🔔 Enable push (one click)"}
        </button>
        <Link
          href="/account/security"
          className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
        >
          Manage settings
        </Link>
      </div>
      {error && (
        <p className="mt-2 rounded border border-red-900/40 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}

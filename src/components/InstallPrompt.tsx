"use client";

import { useEffect, useState } from "react";

/**
 * "Install iKratom" prompt. Listens for the browser's
 * `beforeinstallprompt` event (Chrome/Edge desktop + Android) and
 * surfaces a custom CTA bar at the bottom of the page. On click,
 * triggers the native install dialog.
 *
 * Dismissal is sticky for 14 days (localStorage) so we don't nag
 * users who already said no. Already-installed PWAs (display-mode
 * standalone) never see this.
 *
 * iOS Safari doesn't fire beforeinstallprompt; users have to use
 * Safari's "Add to Home Screen" from the share sheet manually. We
 * detect iOS Safari and show a different message pointing at that
 * flow.
 */

const DISMISS_KEY = "ikratom-install-dismissed-until";

type DeferredPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<DeferredPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already installed (running as PWA) → never show.
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari standalone check
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    // Honor dismissal window.
    const dismissedUntil = parseInt(localStorage.getItem(DISMISS_KEY) ?? "0", 10);
    if (Number.isFinite(dismissedUntil) && Date.now() < dismissedUntil) return;

    // iOS Safari fallback — Safari never fires beforeinstallprompt.
    const ua = window.navigator.userAgent;
    const isIosSafari = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);

    function handler(e: Event) {
      e.preventDefault();
      setDeferred(e as DeferredPromptEvent);
      // Slight delay so we don't jank the first paint.
      setTimeout(() => setVisible(true), 1500);
    }

    window.addEventListener("beforeinstallprompt", handler);

    if (isIosSafari) {
      // Show the manual-instructions banner after a moment.
      setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 2500);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    setVisible(false);
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(Date.now() + fourteenDays));
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      setVisible(false);
    } else {
      dismiss();
    }
    setDeferred(null);
  }

  if (!visible || (!deferred && !iosHint)) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-emerald-700/40 bg-zinc-950 p-3 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>📲</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-100">
            Install iKratom as an app
          </p>
          {deferred ? (
            <p className="mt-0.5 text-xs text-zinc-400">
              One tap → full-screen experience, push alerts, home-screen icon.
            </p>
          ) : iosHint ? (
            <p className="mt-0.5 text-xs text-zinc-400">
              Tap{" "}
              <span className="inline-block rounded bg-zinc-800 px-1 font-mono text-zinc-200">⤴</span>{" "}
              in Safari, then <strong>Add to Home Screen</strong> to install.
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="flex-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

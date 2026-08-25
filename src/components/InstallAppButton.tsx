"use client";

import { useEffect, useState } from "react";

/**
 * Persistent "Install app" button in the top toolbar.
 *
 * Different from <InstallPrompt> (a sticky bottom toast that auto-shows
 * once and goes away on dismissal). This is a button users can always
 * find and tap on demand — even after they dismissed the toast.
 *
 * Hide ONLY when:
 *  - Already running as installed PWA (display-mode: standalone)
 *  - Browser fired beforeinstallprompt then user accepted the prompt
 *
 * Otherwise always visible (icon-only on mobile, icon+label on desktop).
 *
 * Click behavior:
 *  - Chrome/Edge desktop + Android Chrome: fire the captured
 *    beforeinstallprompt event → native install dialog.
 *  - iOS Safari: open a small modal with "Tap ⤴ → Add to Home Screen"
 *    instructions (no programmatic install API on iOS).
 *  - Browser doesn't support installs (Firefox, etc.): open the modal
 *    with a generic explainer + Add-to-Home-Screen hint.
 */

type DeferredPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Mode = "android-chrome" | "ios-safari" | "manual";

export function InstallAppButton({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}) {
  const [deferred, setDeferred] = useState<DeferredPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [mode, setMode] = useState<Mode>("manual");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) {
      setInstalled(true);
      return;
    }

    const ua = window.navigator.userAgent;
    const isIosSafari = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua);
    if (isIosSafari) setMode("ios-safari");

    function handler(e: Event) {
      e.preventDefault();
      setDeferred(e as DeferredPromptEvent);
      setMode("android-chrome");
    }
    function installedHandler() {
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (installed) return null;

  // Always open our themed modal first. If beforeinstallprompt was
  // captured, the modal exposes a "Install now" button that triggers
  // Chrome's native dialog. Letting Chrome auto-open its dialog from
  // the toolbar click works in theory, but the native dialog anchors
  // to the address-bar install icon — if that icon is off-screen
  // (multi-monitor, window positioned too high), the dialog clips and
  // becomes unusable. Going through our modal guarantees the user has
  // visible context + a manual fallback path.
  function click() {
    setShowHelp(true);
  }

  async function triggerNativePrompt() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setShowHelp(false);
    }
    setDeferred(null);
  }

  const compactClass =
    "inline-flex items-center justify-center rounded-md border border-emerald-700/40 bg-emerald-950/30 text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-900/40";

  return (
    <>
      {variant === "mobile" ? (
        <button
          type="button"
          onClick={click}
          aria-label="Install iKratom as an app"
          title="Install iKratom"
          className={`${compactClass} h-9 w-9 text-base`}
        >
          📲
        </button>
      ) : (
        <button
          type="button"
          onClick={click}
          aria-label="Install iKratom as an app"
          title="Install iKratom"
          className={`${compactClass} gap-1.5 px-2.5 py-1 text-xs font-semibold`}
        >
          📲 <span className="hidden lg:inline">Install app</span>
          <span className="lg:hidden">Install</span>
        </button>
      )}

      {showHelp && (
        <div
          role="dialog"
          aria-modal="true"
          // overflow-y-auto on the OVERLAY (not just the panel) so that when the
          // panel is taller than the viewport it scrolls from the top instead of
          // being centred with its head clipped off-screen and unreachable.
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/70 p-4 sm:items-center"
          onClick={() => setShowHelp(false)}
        >
          <div
            // max-h + overflow keeps the panel inside the viewport on short
            // windows and mobile landscape; `my-auto` re-centres it only when it
            // actually fits, so a tall panel starts at the top rather than
            // hanging above it. 100dvh (not vh) accounts for mobile browser
            // chrome, which is what made the header clip on phones.
            className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-emerald-700/40 bg-zinc-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start gap-3">
              <span className="text-3xl" aria-hidden>📲</span>
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Install iKratom as an app</h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Full-screen experience, push alerts when bills move, home-screen icon. Free, no app store.
                </p>
              </div>
            </div>

            {mode === "android-chrome" ? (
              <div className="space-y-3 text-[13px] text-zinc-200">
                <p>One tap installs iKratom as a real app on this device.</p>
                <button
                  type="button"
                  onClick={triggerNativePrompt}
                  className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
                >
                  Install iKratom
                </button>
                <p className="text-[11px] text-zinc-500">
                  If the install dialog appears clipped or off-screen (multi-monitor or window-position quirk),
                  use the install icon{" "}
                  <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-100">⊕</span>{" "}
                  in your address bar instead, or Chrome ⋮ menu →{" "}
                  <strong>Cast, save, and share → Install iKratom</strong>.
                </p>
              </div>
            ) : mode === "ios-safari" ? (
              <ol className="space-y-2 text-[13px] text-zinc-200">
                <li>
                  <strong className="text-emerald-300">1.</strong> Tap the share button{" "}
                  <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-100">⤴</span>{" "}
                  in Safari (bottom of screen on iPhone, top-right on iPad).
                </li>
                <li>
                  <strong className="text-emerald-300">2.</strong> Scroll down and tap{" "}
                  <strong>&quot;Add to Home Screen&quot;</strong>.
                </li>
                <li>
                  <strong className="text-emerald-300">3.</strong> Tap <strong>Add</strong> in the top-right.
                </li>
                <li className="pt-1 text-[11px] text-zinc-500">
                  Only Safari supports installs on iOS — Chrome / Firefox can&apos;t install web apps on iPhone/iPad.
                </li>
              </ol>
            ) : (
              <div className="space-y-3 text-[13px] text-zinc-200">
                <p>To install on this browser:</p>
                <ul className="space-y-1.5 text-zinc-300">
                  <li>
                    <strong className="text-emerald-300">Android Chrome:</strong> tap the ⋮ menu →{" "}
                    <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
                  </li>
                  <li>
                    <strong className="text-emerald-300">Desktop Chrome / Edge:</strong> click the install
                    icon{" "}
                    <span className="inline-block rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-100">⊕</span>{" "}
                    in the address bar.
                  </li>
                  <li>
                    <strong className="text-emerald-300">Firefox:</strong> Firefox doesn&apos;t support
                    home-screen install on most platforms — use Chrome or Edge instead.
                  </li>
                </ul>
                <p className="pt-1 text-[11px] text-zinc-500">
                  Once installed, iKratom opens like a native app — no browser chrome — and can deliver push
                  notifications for legislative alerts in your state.
                </p>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

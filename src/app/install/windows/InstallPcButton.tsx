"use client";

import { useEffect, useState } from "react";

/**
 * Big-CTA PWA install for the /install/windows page. Captures the
 * deferred `beforeinstallprompt` (Chrome/Edge on Windows/Mac/Linux) and
 * fires it on click — iKratom installs as a real windowed desktop app
 * with its own taskbar icon and Start-menu entry. Detects an
 * already-installed session and says so. Browsers without the prompt
 * fall through to the manual steps rendered below on the page.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPcButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [state, setState] = useState<"waiting" | "ready" | "installed" | "manual">("waiting");

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setState("installed");
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setState("ready");
    };
    const onInstalled = () => setState("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const t = setTimeout(() => setState((s) => (s === "waiting" ? "manual" : s)), 2500);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(t);
    };
  }, []);

  if (state === "installed") {
    return (
      <p className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 text-center text-sm font-semibold text-emerald-300">
        ✓ Installed — iKratom is already an app on this device.
      </p>
    );
  }
  if (state === "ready" && deferred) {
    return (
      <button
        onClick={async () => {
          await deferred.prompt();
          const choice = await deferred.userChoice;
          if (choice.outcome === "accepted") setState("installed");
        }}
        className="w-full rounded-md bg-emerald-500 px-6 py-4 text-lg font-bold text-zinc-950 transition hover:bg-emerald-400"
      >
        ⬇ Install iKratom on this PC — one click
      </button>
    );
  }
  return (
    <p className="text-center text-xs text-zinc-500">
      {state === "waiting"
        ? "Checking one-click install support…"
        : "One-click install isn't available in this browser — use the 10-second manual steps below."}
    </p>
  );
}

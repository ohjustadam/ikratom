"use client";

import { useEffect, useState } from "react";

/**
 * First-visit tour for /calls.
 *
 * Lazy-imports driver.js so the ~30KB only loads when actually shown.
 * Persists "seen" flag in localStorage — one-shot per browser. Users
 * can replay via the "?tour=1" query string.
 */
export function CallsTour() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!hasMounted) return;
    const params = new URLSearchParams(window.location.search);
    const force = params.get("tour") === "1";
    const seenKey = "ikratom:calls-tour-seen";
    if (!force && localStorage.getItem(seenKey)) return;

    let cleanup: (() => void) | undefined;
    (async () => {
      const { driver } = await import("driver.js");
      await import("driver.js/dist/driver.css");

      const drv = driver({
        showProgress: true,
        nextBtnText: "Next →",
        prevBtnText: "← Back",
        doneBtnText: "Done — start calling",
        popoverClass: "ikratom-driver-popover",
        steps: [
          {
            element: "header",
            popover: {
              title: "Welcome to your call dashboard",
              description: "Phone calls move legislators 100x more than emails. This page is your home for tracked calls — pick a target, the app launches your dialer, optionally captures a live transcript, and earns you badges.",
              side: "bottom",
              align: "start",
            },
          },
          {
            element: ".grid.grid-cols-3",
            popover: {
              title: "Your call stats",
              description: "Tracks how many calls you've placed, how many actually reached the legislator, and how many unique recipients you've spoken to. Used to award badges.",
              side: "bottom",
            },
          },
          {
            popover: {
              title: "Pick a target",
              description: "Three groups appear below: 📍 Your reps (the people who actually represent you), 🎯 Highest-leverage targets in your state (champions to reinforce + hostiles to persuade), and 🎤 Upcoming public meetings (city council Zooms — show up to those too).",
            },
          },
          {
            popover: {
              title: "Each row expands",
              description: "Tap a legislator row to open the call panel. You'll see their phone number, an optional 'Track this call' toggle, and (for 2-party-consent states) a disclosure prompt before recording.",
            },
          },
          {
            popover: {
              title: "When you tap 'Call now'",
              description: "Your device's dialer opens with the legislator's number prefilled. If you opted into transcription, the app captures live transcript via on-device speech recognition — **audio never leaves your phone**.",
            },
          },
          {
            popover: {
              title: "💡 Pro tip: use earbuds",
              description: "Earbuds-with-mic let you keep the call private (no speakerphone) while the app still captures the audio. Wired or Bluetooth — both work.",
            },
          },
          {
            popover: {
              title: "Pick an outcome",
              description: "After the call, tap Reached / Voicemail / Busy / No answer / Declined. The AI summarizes what was discussed. You can optionally submit the transcript for admin review → public 'what is government saying' intel corpus.",
            },
          },
          {
            popover: {
              title: "Badges + goals",
              description: "First call · Capital Seven (7 reps) · Coast to Coast (5 states) · Century Club (100 calls). Goals auto-track from your session count. Watch this space for weekly challenges + the community leaderboard.",
            },
          },
          {
            popover: {
              title: "You're ready",
              description: "Pick a target below and make your first call. Even a 2-minute voicemail beats 50 emails. Welcome to the war room.",
            },
          },
        ],
        onDestroyStarted: () => {
          localStorage.setItem(seenKey, new Date().toISOString());
          drv.destroy();
        },
      });
      drv.drive();
      cleanup = () => drv.destroy();
    })().catch((e) => console.error("[calls-tour]", e));

    return () => cleanup?.();
  }, [hasMounted]);

  return null;
}

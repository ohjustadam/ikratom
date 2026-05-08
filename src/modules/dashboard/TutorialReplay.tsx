"use client";

import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

/**
 * Replay tutorials panel — small dashboard card so anyone can re-watch a
 * tour they've already dismissed.
 *
 * Implementation: clicking a chip navigates to /dashboard?replay=<id>.
 * The dashboard reads the param and passes `forceShow` to the matching
 * tour component. Keeping replay state in the URL means back-button
 * works, the tour is deep-linkable, and we don't need extra client
 * coordination between the panel and the tour.
 */
export function TutorialReplay({ isLeader }: { isLeader: boolean }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-bold text-zinc-200">Replay a tutorial</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Forgot how something works? Re-run any walkthrough.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href="/dashboard?replay=onboarding"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500 hover:text-emerald-300"
        >
          <span>▶</span> Cockpit tour
        </a>
        <a
          href="/dashboard?replay=welcome"
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500 hover:text-emerald-300"
        >
          <span>▶</span> Community + DMs intro
        </a>
        {isLeader && (
          <a
            href="/dashboard?replay=leader"
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-500"
          >
            <span>🎖</span> Leader walkthrough
          </a>
        )}
      </div>
    </section>
  );
}

/**
 * Welcome-tour driver.js variant — the "show me Community / DMs / first
 * action" walkthrough. Auto-fires never; only triggered via replay link.
 */
export function WelcomeReplayTour({ forceShow }: { forceShow: boolean }) {
  useEffect(() => {
    if (!forceShow) return;
    if (typeof window === "undefined") return;

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayOpacity: 0.6,
      stagePadding: 4,
      stageRadius: 8,
      steps: [
        {
          popover: {
            title: "Community, DMs, and your first action",
            description:
              "Three big things to know about iKratom outside the war-room widgets. 30 seconds.",
          },
        },
        {
          popover: {
            title: "Community",
            description:
              "/forum has the Lounge (live chat) at the top, plus state-by-state forums below. Lurk first; jump in when ready.",
          },
        },
        {
          popover: {
            title: "Encrypted DMs",
            description:
              "/messages — every message is end-to-end encrypted with libsodium. Even iKratom admins can't read them. Group DMs coming soon.",
          },
        },
        {
          popover: {
            title: "Your first action",
            description:
              "/campaigns shows live calls-to-action matching your state. One click sends a prefilled email to your legislators. That first action is what flips the streak counter to 1.",
          },
        },
      ],
    });
    d.drive();
    return () => d.destroy();
  }, [forceShow]);

  return null;
}

"use client";

import { useEffect, useTransition } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { markOnboardingComplete } from "./actions";

/**
 * First-time visitor walkthrough — clickable step-through tour using
 * driver.js (~10kb, no React-specific deps). Triggers automatically on
 * the first /dashboard render after signup; replayable from /account.
 *
 * Each step targets a `[data-tour="..."]` selector on the page. If a
 * targeted element doesn't exist (the user hasn't unlocked it yet), the
 * step is skipped — keeps the tour resilient as widgets get
 * customized.
 *
 * On completion or skip, we set `onboarded_at` on the layout row so we
 * never auto-trigger again. Replay button in /account/security or
 * /account resets it.
 */
export function OnboardingTour({
  shouldShow,
  forceShow = false,
}: {
  shouldShow: boolean;
  forceShow?: boolean;
}) {
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!shouldShow && !forceShow) return;
    if (typeof window === "undefined") return;

    const d = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayOpacity: 0.6,
      stagePadding: 4,
      stageRadius: 8,
      popoverClass: "ikratom-driver-popover",
      onDestroyed: () => {
        startTransition(async () => {
          await markOnboardingComplete();
        });
      },
      steps: [
        {
          element: '[data-tour="briefing"]',
          popover: {
            title: "Today's briefing",
            description:
              "This is your at-a-glance status. Hostile bills, live campaigns, upcoming waves you've joined, unread alerts — all here. Click any line to drill in.",
            side: "bottom",
          },
        },
        {
          element: '[data-tour="my-reps"]',
          popover: {
            title: "Your reps",
            description:
              "Federal + state legislators for your address. One-click email or call, prefilled from your profile.",
            side: "top",
          },
        },
        {
          element: '[data-tour="streak"]',
          popover: {
            title: "Action streak",
            description:
              "Each day you send at least one campaign action, your streak ticks up. Keep it alive — your longest streak shows on your profile.",
            side: "bottom",
          },
        },
        {
          element: '[data-cockpit-customize-button]',
          popover: {
            title: "Make it yours",
            description:
              "Hide widgets you don't use, reorder them, pick an accent color. Replay this tour any time from your account settings.",
            side: "left",
          },
        },
        {
          popover: {
            title: "You're set.",
            description:
              "Bills, campaigns, your reps — everything in one cockpit. Welcome to the war room.",
          },
        },
      ],
    });
    d.drive();

    return () => {
      d.destroy();
    };
  }, [shouldShow, forceShow, startTransition]);

  return null;
}

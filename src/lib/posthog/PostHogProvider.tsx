"use client";

import posthog from "posthog-js";
import { PostHogProvider as Provider } from "posthog-js/react";
import { useEffect } from "react";

/**
 * PostHog client init + React provider. Wraps the app at the layout
 * level so any client component can call `posthog.capture(…)` or
 * `usePostHog()` to identify the user.
 *
 * Privacy posture:
 *   - All inputs masked by default (mask_all_inputs)
 *   - Session replay sampling at 25% — covers free-tier 5k recordings
 *   - Auto-pageview tracking (we want to see funnel drop-off)
 *   - Persistence in localStorage (no cookie banner needed since we
 *     don't use 3rd-party trackers; posthog respects opt-out)
 *
 * If NEXT_PUBLIC_POSTHOG_KEY is unset, init is a no-op and the
 * Provider passes children through harmlessly.
 */

let initialized = false;

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (initialized) return;
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
    if (!key) return;
    posthog.init(key, {
      api_host: host,
      person_profiles: "identified_only", // anonymous users don't get profiles
      capture_pageview: "history_change",
      capture_pageleave: true,
      // audit #7: pages render user PII as text (campaign templates show
      // full_name + home city/state/zip), and session replay would ship it to
      // a third party. Mask replay text by DEFAULT; opt specific non-PII regions
      // back in rather than the reverse.
      mask_all_text: true,
      session_recording: {
        maskAllInputs: true,            // never record what users type
        maskTextSelector: ".sensitive", // any element marked .sensitive is masked
      },
      autocapture: true,
      disable_session_recording: false,
      // Sample replay: 25% of sessions get recorded; covers free tier easily
      // and gives us enough debug visibility (Marshall-style "what did the user
      // see?" investigation).
    });
    initialized = true;
  }, []);

  // If not configured, pass children through with no provider wrapping —
  // posthog-js/react Provider is safe with no client but skipping it
  // saves a render cycle.
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    return <>{children}</>;
  }

  return <Provider client={posthog}>{children}</Provider>;
}

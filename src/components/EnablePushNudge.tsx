"use client";

import { useEffect, useState } from "react";
import { useChrome } from "./chrome/ChromeProvider";
import { EnablePushNudgeClient } from "./EnablePushNudgeClient";

type Context = "pulse" | "alert" | "state" | "meeting" | "bill" | "default";

const COPY: Record<Context, { headline: string; sub: string }> = {
  pulse: {
    headline: "🔔 You're reading /pulse — get the next alert pushed",
    sub: "You're already here. Enable push so the next critical alert wakes your phone — you won't need to refresh.",
  },
  alert: {
    headline: "🔔 Don't miss the next one — push is one click",
    sub: "You found this alert. Push notifications mean the next critical event in your state hits your phone within minutes of detection.",
  },
  state: {
    headline: "🔔 Enable push for in-state alerts",
    sub: "You care about your state's policy. Push fires the moment a bill moves, a hearing is scheduled, or a critical alert lands — filtered to your state only.",
  },
  meeting: {
    headline: "🔔 Get reminded 7d / 3d / 1d before this meeting",
    sub: "You've found a meeting you might attend. Enable push and we'll remind you ahead of time + ping you live if it gets broadcast.",
  },
  bill: {
    headline: "🔔 Get pushed when this bill changes status",
    sub: "Track this bill. We'll push you the moment it moves through committee, hits the floor, gets amended, or signed.",
  },
  default: {
    headline: "🔔 Turn this into a live feed — one click",
    sub: "You're signed in. Enable browser push and the alerts that matter to your state reach your phone within minutes.",
  },
};

/**
 * EnablePushNudge — for SIGNED-IN users who haven't subscribed to push yet.
 *
 * Complements SignUpNudge (which handles anonymous visitors). This one
 * fires for users who are already past account-creation but haven't
 * enabled browser push — the second-largest activation gap after signup.
 *
 * Server-side gates render: signed-in + zero push_subscriptions.
 * Renders nothing if user has push, isn't signed in, or VAPID isn't
 * configured (no point promising push that can't fire).
 *
 * Browser-side, the actual Enable button is on EnablePushNudgeClient
 * since Notification.requestPermission() must be invoked from a user
 * click handler (browser security spec). The button there reuses the
 * VAPID flow from PushSubscribe — but with context-tuned copy from
 * this server component.
 */
export function EnablePushNudge({
  context = "default",
  stateCode,
  className,
}: {
  context?: Context;
  stateCode?: string | null;
  className?: string;
}) {
  // Client-side gate as of 2026-07-30. This was an async SERVER component, and
  // its three awaits made every page rendering it uncacheable — /states/:code,
  // /meetings/:id, /pulse, /bills/:id, /alerts/:id. After the credit outage,
  // paying for a full server render on every crawl of those pages is untenable.
  //
  // Each gate moved cleanly, and one got MORE accurate:
  //   - signed-in     → /api/me, already fetched once by ChromeProvider.
  //   - VAPID key     → NEXT_PUBLIC_VAPID_PUBLIC_KEY. getPushVapidPublicKey()
  //                     only ever returned this same public env var, so the
  //                     server round-trip bought nothing.
  //   - has push yet? → asked THIS BROWSER instead of listing the account's
  //                     subscriptions. Behaviour change, and a deliberate
  //                     improvement: push permission is per-device, so a user
  //                     subscribed on their phone previously never saw this
  //                     nudge on their laptop, where they genuinely had no push.
  const { me, loading } = useChrome();
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
  // null = "not determined yet", so we never flash the nudge at someone who is
  // already subscribed (the ChromeGates rule: render nothing until we know).
  const [alreadySubscribed, setAlreadySubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          if (!cancelled) setAlreadySubscribed(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setAlreadySubscribed(Boolean(sub));
      } catch {
        // Can't tell → assume subscribed, i.e. stay silent. Nagging a user who
        // already enabled push is the worse failure.
        if (!cancelled) setAlreadySubscribed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || !me?.userId) return null;
  if (!vapidPublicKey) return null;
  if (alreadySubscribed !== false) return null;

  const copy = COPY[context];
  const headline = stateCode && context === "state"
    ? copy.headline.replace("your state", stateCode)
    : copy.headline;
  const sub = stateCode && (context === "state" || context === "alert" || context === "pulse")
    ? copy.sub.replace("your state", stateCode)
    : copy.sub;

  return (
    <EnablePushNudgeClient
      headline={headline}
      sub={sub}
      vapidPublicKey={vapidPublicKey}
      className={className}
    />
  );
}

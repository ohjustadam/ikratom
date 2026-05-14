import { createClient } from "@/lib/supabase/server";
import { getPushVapidPublicKey, listMyPushSubscriptions } from "@/modules/auth/actions-push";
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
export async function EnablePushNudge({
  context = "default",
  stateCode,
  className,
}: {
  context?: Context;
  stateCode?: string | null;
  className?: string;
}) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const vapidPublicKey = await getPushVapidPublicKey();
  if (!vapidPublicKey) return null;

  const subs = await listMyPushSubscriptions();
  if (subs.length > 0) return null;

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

"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Web Push subscription management.
 *
 * Subscriptions are created by the browser via service-worker
 * `pushManager.subscribe()`. We persist them so a server-side push (when
 * VAPID keys are configured) can target every subscribed device the user
 * owns.
 *
 * No-ops cleanly when VAPID isn't configured — UI explains the state.
 */

export async function getPushVapidPublicKey() {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;
}

export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  // window.location.origin at subscribe time. Used to detect + prune
  // subscriptions registered against localhost during dev, which fail
  // when the click handler navigates to a now-unreachable origin.
  origin?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  if (!input.endpoint || !input.p256dh || !input.auth) {
    return { error: "Missing subscription fields." };
  }

  // Detect new-subscription vs reconnect so we only fire the welcome
  // push on first-ever device subscribe.
  const { data: existing } = await supabase
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .eq("endpoint", input.endpoint)
    .maybeSingle();
  const isNewSubscription = !existing;

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.userAgent?.slice(0, 500) ?? null,
        origin: input.origin?.slice(0, 200) ?? null,
      },
      { onConflict: "user_id,endpoint" },
    );
  if (error) return { error: error.message };

  // Fire-and-forget welcome push on first-ever subscribe per device.
  // Closes the "did push actually work?" doubt the moment user opts
  // in — without waiting for the test-push button or a real alert.
  if (isNewSubscription) {
    const { sendPush, isPushConfigured } = await import("@/lib/push/send");
    if (isPushConfigured()) {
      sendPush(
        { endpoint: input.endpoint, keys: { p256dh: input.p256dh, auth: input.auth } },
        {
          title: "🎉 Push notifications are on",
          body: "You'll get a ping the moment a kratom bill, hearing, or live meeting moves in your state. Welcome to the war room.",
          link: "/dashboard",
          tag: "welcome-push",
        },
      ).catch((e) => {
        console.error("[push-welcome] failed (non-blocking):", e);
      });
    }
  }
  return { ok: true };
}

export async function deletePushSubscription(endpoint: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  if (error) return { error: error.message };
  return { ok: true };
}

export async function listMyPushSubscriptions() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Send a test push to all of the current user's subscriptions.
 * Lets users verify their setup works without waiting for a real
 * alert to fire — confidence-building after they enable push.
 *
 * Returns counts so the UI can confirm delivery attempts.
 */
export async function sendTestPushToMe() {
  const { sendPush, isPushConfigured } = await import("@/lib/push/send");
  if (!isPushConfigured()) {
    return { error: "Push notifications aren't configured on this server." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  if (!subs || subs.length === 0) {
    return { error: "You don't have any push subscriptions yet. Enable push above first." };
  }

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  const payload = {
    title: "🔔 Test push from iKratom",
    body: "Push notifications are working. Real alerts (live meetings, bill events) will reach you the same way.",
    link: "/notifications",
    tag: "test-push",
  };
  for (const s of subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
    const r = await sendPush(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      payload,
    );
    if (r.ok) sent++;
    else if ("gone" in r && r.gone) dead.push(s.id);
    else failed++;
  }
  // Prune dead subscriptions (revoked from browser)
  if (dead.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", dead);
  }
  return {
    ok: true,
    sent,
    failed,
    pruned: dead.length,
    subscriptions: subs.length,
  };
}

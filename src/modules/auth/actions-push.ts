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
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  if (!input.endpoint || !input.p256dh || !input.auth) {
    return { error: "Missing subscription fields." };
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.userAgent?.slice(0, 500) ?? null,
      },
      { onConflict: "user_id,endpoint" },
    );
  if (error) return { error: error.message };
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

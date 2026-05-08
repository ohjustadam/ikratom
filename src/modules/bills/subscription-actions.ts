"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Bill subscriptions — the data behind the "🔔 Notify me" button on
 * /bills/[id]. One row per (user, bill) records what kinds of events
 * the user wants to hear about. The hourly cron fans out notifications
 * matching those preferences.
 */

export type BillSubscription = {
  user_id: string;
  bill_id: string;
  notify_meeting_reminder: boolean;
  notify_status_change: boolean;
  notify_new_alert: boolean;
};

/**
 * Returns the calling user's subscription row for this bill, or null
 * when not subscribed (or signed out).
 */
export async function getBillSubscription(billId: string): Promise<BillSubscription | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("bill_subscriptions")
    .select("user_id, bill_id, notify_meeting_reminder, notify_status_change, notify_new_alert")
    .eq("user_id", user.id)
    .eq("bill_id", billId)
    .maybeSingle();
  return (data as BillSubscription | null) ?? null;
}

/**
 * Subscribe the caller to a bill with optional event-type toggles.
 * Defaults to all three event types on (meeting + status + alerts).
 * Idempotent — re-subscribing just updates the toggles.
 */
export async function subscribeToBill(input: {
  billId: string;
  meeting?: boolean;
  status?: boolean;
  alerts?: boolean;
}): Promise<{ ok: true } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(input.billId)) return { error: "Invalid bill id." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to subscribe." };

  const row = {
    user_id: user.id,
    bill_id: input.billId,
    notify_meeting_reminder: input.meeting ?? true,
    notify_status_change: input.status ?? true,
    notify_new_alert: input.alerts ?? true,
  };

  const { error } = await supabase
    .from("bill_subscriptions")
    .upsert(row, { onConflict: "user_id,bill_id" });
  if (error) return { error: error.message };
  return { ok: true };
}

export async function unsubscribeFromBill(billId: string): Promise<{ ok: true } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(billId)) return { error: "Invalid bill id." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { error } = await supabase
    .from("bill_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("bill_id", billId);
  if (error) return { error: error.message };
  return { ok: true };
}

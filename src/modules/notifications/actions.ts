"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type NotificationPrefs = {
  notify_state_campaigns: boolean;
  notify_local_campaigns: boolean;
  notify_federal_campaigns: boolean;
  in_app: boolean;
  email: boolean;
  digest: "instant" | "daily" | "weekly" | "off";
  daily_brief_push: boolean;
  dnd_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
};

export async function getNotificationPrefs() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("user_id", user.id)
    .single();
  return data as NotificationPrefs | null;
}

export async function updateNotificationPrefs(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const digestRaw = String(formData.get("digest") ?? "instant");
  const digest = (["instant", "daily", "weekly", "off"] as const).includes(
    digestRaw as never
  )
    ? digestRaw
    : "instant";

  // Quiet hours: "HH:MM" 24h or null. Timezone: IANA string captured by the
  // form so the delivery paths can evaluate the local-time window.
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const qhsRaw = String(formData.get("quiet_hours_start") ?? "");
  const qheRaw = String(formData.get("quiet_hours_end") ?? "");
  const tzRaw = String(formData.get("timezone") ?? "");
  const quiet_hours_start = timeRe.test(qhsRaw) ? qhsRaw : null;
  const quiet_hours_end = timeRe.test(qheRaw) ? qheRaw : null;
  const timezone = /^[A-Za-z0-9_+/-]{1,64}$/.test(tzRaw) ? tzRaw : null;

  const update = {
    user_id: user.id,
    notify_state_campaigns: formData.get("notify_state_campaigns") === "on",
    notify_local_campaigns: formData.get("notify_local_campaigns") === "on",
    notify_federal_campaigns: formData.get("notify_federal_campaigns") === "on",
    in_app: formData.get("in_app") === "on",
    email: formData.get("email") === "on",
    digest,
    daily_brief_push: formData.get("daily_brief_push") === "on",
    dnd_enabled: formData.get("dnd_enabled") === "on",
    quiet_hours_start,
    quiet_hours_end,
    timezone,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(update, { onConflict: "user_id" });

  if (error) return { error: error.message };
  revalidatePath("/account");
  return { ok: true };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  return count ?? 0;
}

export async function listNotifications(limit = 50) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function markNotificationRead(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

export async function markAllRead() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

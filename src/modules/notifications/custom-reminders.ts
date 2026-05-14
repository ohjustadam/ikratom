"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * User-controlled custom reminders. The owner directive frames this
 * as "their phone becomes their extra hand" — every bill / meeting /
 * campaign / legislator / piece of news should be one click from
 * "remind me about this at THIS time."
 *
 * Storage: user_custom_reminders (migration 0132).
 * Fire path: scripts/fire-custom-reminders.mjs runs hourly, inserts
 * a row into notifications table when due, existing push fan-out
 * handles delivery.
 */

export type ReminderTargetKind =
  | "bill"
  | "meeting"
  | "campaign"
  | "legislator"
  | "news_item"
  | "custom";

export type CustomReminder = {
  id: string;
  target_kind: ReminderTargetKind;
  target_id: string | null;
  remind_at: string;
  title: string;
  message: string | null;
  fired_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

const MAX_TITLE = 100;
const MAX_MESSAGE = 500;
// Cap how far in the future a reminder can be set. 2 years matches
// typical legislative cycles — beyond that the target row may have
// moved and we'd just create dead reminders.
const MAX_HORIZON_MS = 2 * 365 * 86_400_000;

export async function createCustomReminder(input: {
  target_kind: ReminderTargetKind;
  target_id: string | null;
  remind_at: string; // ISO-8601
  title: string;
  message?: string | null;
}): Promise<{ ok: true; id: string } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Validate inputs at the boundary (the DB has constraints, but a
  // friendly error message beats a 500).
  const title = (input.title ?? "").trim();
  if (!title) return { error: "Reminder title is required." };
  if (title.length > MAX_TITLE) return { error: `Title too long (max ${MAX_TITLE} chars).` };
  const message = (input.message ?? "").trim() || null;
  if (message && message.length > MAX_MESSAGE) return { error: `Message too long (max ${MAX_MESSAGE} chars).` };

  const remindAt = new Date(input.remind_at);
  if (Number.isNaN(remindAt.getTime())) return { error: "Invalid date/time." };
  const now = Date.now();
  if (remindAt.getTime() < now - 60_000) return { error: "Reminder time is in the past." };
  if (remindAt.getTime() > now + MAX_HORIZON_MS) return { error: "Reminder is too far in the future (2 year max)." };

  const validKinds: ReminderTargetKind[] = ["bill", "meeting", "campaign", "legislator", "news_item", "custom"];
  if (!validKinds.includes(input.target_kind)) return { error: "Invalid reminder kind." };

  // For non-custom kinds, target_id is required. For custom, it must
  // be NULL (the DB doesn't enforce this — server does for cleanliness).
  const target_id = input.target_kind === "custom" ? null : (input.target_id || null);
  if (input.target_kind !== "custom" && !target_id) {
    return { error: "target_id is required for non-custom reminders." };
  }

  const { data, error } = await supabase
    .from("user_custom_reminders")
    .insert({
      user_id: user.id,
      target_kind: input.target_kind,
      target_id,
      remind_at: remindAt.toISOString(),
      title,
      message,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  revalidatePath("/reminders");
  return { ok: true, id: data.id as string };
}

export async function listCustomReminders(): Promise<CustomReminder[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("user_custom_reminders")
    .select("id, target_kind, target_id, remind_at, title, message, fired_at, cancelled_at, created_at")
    .eq("user_id", user.id)
    .order("remind_at", { ascending: true })
    .limit(200);
  return (data ?? []) as CustomReminder[];
}

export async function cancelCustomReminder(id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  // RLS already restricts to own rows, but re-check user_id for defense in depth.
  const { error } = await supabase
    .from("user_custom_reminders")
    .update({ cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("fired_at", null); // can't cancel one that already fired
  if (error) return { error: error.message };
  revalidatePath("/reminders");
  return { ok: true };
}

export async function deleteCustomReminder(id: string): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("user_custom_reminders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/reminders");
  return { ok: true };
}

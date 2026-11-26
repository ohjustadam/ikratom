"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { prefsToRow, sanitizePrefs } from "@/lib/chat-prefs";

/**
 * Save a member's Lounge settings to their account (B8, table lounge_prefs).
 * Reads go straight to Supabase from the browser under the self-only RLS
 * policy, so opening the chat wakes no server function; only a change does.
 * The client waits for a pause before saving, so tapping A+ four times is one
 * write, and the limit here stops a script from hammering the table.
 */
export async function saveLoungePrefs(input: unknown): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to save your chat settings." };

  if (!(await checkRateLimit(`lounge:prefs:${user.id}`, 20, 60))) {
    return { error: "Too many changes at once. Try again in a minute." };
  }

  const row = prefsToRow(sanitizePrefs(input));
  const { error } = await supabase
    .from("lounge_prefs")
    .upsert({ user_id: user.id, ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    console.error("saveLoungePrefs failed:", error.message);
    return { error: "Couldn't save your chat settings. They still apply on this device." };
  }
  return { ok: true };
}

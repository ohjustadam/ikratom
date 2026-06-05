"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Persist a signed-in user's UI preferences (theme / brand accent / mode)
 * to their profile so they follow the user across devices. No-ops cleanly
 * for anonymous users (they rely on localStorage). RLS profiles_self_write
 * gates the update to the caller's own row via .eq("id", user.id).
 */
export const UI_THEMES = ["dark", "light"] as const;
export const UI_ACCENTS = ["emerald", "blue", "violet", "amber", "rose"] as const;
export const UI_MODES = ["normal", "war-room"] as const;

export async function saveUiPrefs(input: {
  theme?: string;
  accent?: string;
  mode?: string;
}): Promise<{ ok: true } | { error: string }> {
  const update: Record<string, string> = {};
  if (input.theme !== undefined) {
    if (!UI_THEMES.includes(input.theme as (typeof UI_THEMES)[number])) return { error: "Invalid theme." };
    update.ui_theme = input.theme;
  }
  if (input.accent !== undefined) {
    if (!UI_ACCENTS.includes(input.accent as (typeof UI_ACCENTS)[number])) return { error: "Invalid accent." };
    update.ui_accent = input.accent;
  }
  if (input.mode !== undefined) {
    if (!UI_MODES.includes(input.mode as (typeof UI_MODES)[number])) return { error: "Invalid mode." };
    update.ui_mode = input.mode;
  }
  if (Object.keys(update).length === 0) return { error: "Nothing to update." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

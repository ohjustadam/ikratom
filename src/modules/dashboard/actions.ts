"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCachedUser } from "@/lib/supabase/server";
import { reconcileLayout, type WidgetSlot } from "./widgets/types";

/**
 * Cockpit layout server actions. Every user has an implicit
 * user_dashboard_layouts row — we lazily create it on first save.
 *
 * Read returns the reconciled layout (default + user overrides) so
 * the page never has to know about empty/partial DB state.
 */

export type CockpitLayout = {
  widgets: WidgetSlot[];
  accent_color: "emerald" | "amber" | "blue" | "red" | "zinc";
  onboarded_at: string | null;
};

export async function getCockpitLayout(): Promise<CockpitLayout | null> {
  const user = await getCachedUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data } = await supabase
    .from("user_dashboard_layouts")
    .select("widgets, accent_color, onboarded_at")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    widgets: reconcileLayout(data?.widgets),
    accent_color:
      (data?.accent_color as CockpitLayout["accent_color"] | undefined) ?? "emerald",
    onboarded_at: data?.onboarded_at ?? null,
  };
}

export async function saveCockpitLayout(input: {
  widgets: WidgetSlot[];
  accent_color?: CockpitLayout["accent_color"];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Sanity: clamp widget array length and validate ids via reconcile
  const widgets = reconcileLayout(input.widgets).slice(0, 50);
  const accent = input.accent_color ?? "emerald";

  const { error } = await supabase
    .from("user_dashboard_layouts")
    .upsert(
      {
        user_id: user.id,
        widgets,
        accent_color: accent,
      },
      { onConflict: "user_id" },
    );
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markOnboardingComplete() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("user_dashboard_layouts")
    .upsert(
      {
        user_id: user.id,
        onboarded_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) return { error: error.message };
  return { ok: true };
}

export async function resetOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("user_dashboard_layouts")
    .update({ onboarded_at: null })
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EmailPreset = {
  id: string;
  user_id: string;
  name: string;
  body: string;
  signature: string | null;
  tone: "firm" | "pleading" | "business" | "personal";
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

const VALID_TONES = ["firm", "pleading", "business", "personal"] as const;

export async function listMyEmailPresets(): Promise<EmailPreset[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("user_email_presets")
    .select("*")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  return ((data ?? []) as EmailPreset[]);
}

export async function createEmailPreset(input: {
  name: string;
  body: string;
  signature?: string;
  tone?: "firm" | "pleading" | "business" | "personal";
  isDefault?: boolean;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  const name = (input.name ?? "").trim();
  const body = (input.body ?? "").trim();
  if (name.length < 1 || name.length > 60) return { error: "Name must be 1–60 chars." };
  if (body.length < 1 || body.length > 4000) return { error: "Body must be 1–4000 chars." };
  const tone = input.tone && VALID_TONES.includes(input.tone) ? input.tone : "firm";

  const { data, error } = await supabase
    .from("user_email_presets")
    .insert({
      user_id: user.id,
      name,
      body,
      signature: input.signature?.trim() || null,
      tone,
      is_default: !!input.isDefault,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/account/email-presets");
  return { ok: true, preset: data as EmailPreset };
}

export async function updateEmailPreset(input: {
  id: string;
  name?: string;
  body?: string;
  signature?: string;
  tone?: "firm" | "pleading" | "business" | "personal";
  isDefault?: boolean;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { error: "Invalid id." };

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const v = input.name.trim();
    if (v.length < 1 || v.length > 60) return { error: "Name must be 1–60 chars." };
    update.name = v;
  }
  if (input.body !== undefined) {
    const v = input.body.trim();
    if (v.length < 1 || v.length > 4000) return { error: "Body must be 1–4000 chars." };
    update.body = v;
  }
  if (input.signature !== undefined) update.signature = input.signature.trim() || null;
  if (input.tone !== undefined && VALID_TONES.includes(input.tone)) update.tone = input.tone;
  if (input.isDefault !== undefined) update.is_default = input.isDefault;

  const { error } = await supabase
    .from("user_email_presets")
    .update(update)
    .eq("id", input.id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/account/email-presets");
  return { ok: true };
}

export async function deleteEmailPreset(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };
  const { error } = await supabase
    .from("user_email_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/account/email-presets");
  return { ok: true };
}

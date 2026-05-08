"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

export type Announcement = {
  id: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_href: string | null;
  tone: "info" | "success" | "warn" | "danger";
  pinned: boolean;
  publish_at: string;
};

const VALID_TONES = ["info", "success", "warn", "danger"] as const;

/** User-facing read — visible-and-not-dismissed announcements. */
export async function listVisibleAnnouncements(): Promise<Announcement[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase.rpc("visible_announcements", { p_user_id: user.id });
  return ((data ?? []) as Announcement[]);
}

export async function dismissAnnouncement(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };
  const { error } = await supabase
    .from("announcement_dismissals")
    .upsert({ user_id: user.id, announcement_id: id });
  if (error) return { error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

// ── Admin ──────────────────────────────────────────────────────

export async function listAllAnnouncements() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .order("publish_at", { ascending: false });
  if (error) return { error: error.message };
  return { ok: true, rows: data ?? [] };
}

export async function createAnnouncement(input: {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
  tone?: "info" | "success" | "warn" | "danger";
  pinned?: boolean;
  expiresAt?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 1 || title.length > 120) return { error: "Title must be 1–120 chars." };
  if (body.length < 1 || body.length > 2000) return { error: "Body must be 1–2000 chars." };
  const tone = input.tone && (VALID_TONES as readonly string[]).includes(input.tone) ? input.tone : "info";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .insert({
      title,
      body,
      cta_label: input.ctaLabel?.trim() || null,
      cta_href: input.ctaHref?.trim() || null,
      tone,
      pinned: !!input.pinned,
      expires_at: input.expiresAt || null,
      created_by: ctx.userId,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  await recordAdminAction({ action: "announcement.create", targetId: data.id, details: { title } });
  revalidatePath("/admin/announcements");
  revalidatePath("/dashboard");
  return { ok: true, announcement: data };
}

export async function deleteAnnouncement(id: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { error: error.message };
  await recordAdminAction({ action: "announcement.delete", targetId: id });
  revalidatePath("/admin/announcements");
  return { ok: true };
}

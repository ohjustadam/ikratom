"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectModerationSignals } from "@/lib/moderation";
import { isAudience } from "./audience";
import { deletePhotoRow } from "./photo-upload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["nudity", "harassment", "personal_info", "spam", "violence", "other"]);

type Result = { ok: true } | { error: string };

/**
 * Change a photo's audience or caption. Runs as the member: the column grant
 * (audience, caption) + own-row RLS in 0286 are what make this safe.
 */
export async function updatePhoto(id: string, patch: { audience?: string; caption?: string }): Promise<Result> {
  if (!UUID_RE.test(id)) return { error: "Unknown photo." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const update: Record<string, string | null> = {};
  if (patch.audience !== undefined) {
    if (!isAudience(patch.audience)) return { error: "Invalid privacy level." };
    update.audience = patch.audience;
  }
  if (patch.caption !== undefined) {
    const caption = patch.caption.trim();
    if (caption.length > 300) return { error: "Captions are 300 characters at most." };
    const s = detectModerationSignals(caption);
    if (s.phones.length || s.emails.length) return { error: "Remove phone numbers and email addresses from the caption." };
    update.caption = caption || null;
  }
  if (!Object.keys(update).length) return { ok: true };

  const { data, error } = await supabase.from("member_photos").update(update).eq("id", id).select("id");
  if (error || !data?.length) return { error: "Could not update that photo." };
  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/account/photos");
  return { ok: true };
}

/** Delete one of your photos: the row, its R2 object, and any avatar/cover pointer. */
export async function deletePhoto(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { error: "Unknown photo." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };
  const ok = await deletePhotoRow(createServiceRoleClient(), user.id, id);
  if (!ok) return { error: "Could not delete that photo." };
  revalidatePath(`/profile/${user.id}`);
  revalidatePath("/account/photos");
  revalidatePath("/account/profile");
  return { ok: true };
}

/** Report a photo you can see. Three different reporters hide it for review. */
export async function reportPhoto(id: string, reason: string, note?: string): Promise<Result> {
  if (!UUID_RE.test(id) || !REASONS.has(reason)) return { error: "Pick a reason." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to report." };
  if (!(await checkRateLimit(`photo-report:${user.id}`, 20, 86_400))) return { error: "You've sent a lot of reports today." };
  const { data, error } = await supabase.rpc("report_member_photo", {
    p_photo: id,
    p_reason: reason,
    p_note: (note ?? "").trim().slice(0, 300) || null,
  });
  if (error || data !== true) return { error: "Could not report that photo." };
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { detectModerationSignals } from "@/lib/moderation";
import { isAudience } from "./audience";
import { deletePhotoRow } from "./photo-upload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: true } | { error: string };

// Reporting a photo goes through the shared system: <ReportButton
// targetType="member_photo" /> (modules/reports, migration 0288).

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

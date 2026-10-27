"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deletePhotoRow } from "./photo-upload";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a reported member photo (/admin/moderation/photos).
 *   restore — the reports were wrong: clear them and make the photo visible again
 *   remove  — delete the row and the R2 object (the audit log keeps the record)
 */
export async function resolvePhotoReport(photoId: string, decision: "restore" | "remove"): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) return { error: "Not authorized." };
  if (!UUID_RE.test(photoId) || (decision !== "restore" && decision !== "remove")) return { error: "Bad request." };

  const svc = createServiceRoleClient();
  const { data } = await svc.from("member_photos").select("owner_id, kind, report_count, status").eq("id", photoId).maybeSingle();
  const photo = data as { owner_id: string; kind: string; report_count: number; status: string } | null;
  if (!photo) return { error: "That photo no longer exists." };

  const { data: reports } = await svc.from("member_photo_reports").select("reason").eq("photo_id", photoId);
  const reasons = ((reports ?? []) as { reason: string }[]).map((r) => r.reason);

  if (decision === "restore") {
    await svc.from("member_photo_reports").delete().eq("photo_id", photoId);
    const { error } = await svc.from("member_photos").update({ status: "active", report_count: 0 }).eq("id", photoId);
    if (error) return { error: "Could not restore the photo." };
  } else if (!(await deletePhotoRow(svc, photo.owner_id, photoId))) {
    return { error: "Could not remove the photo." };
  }

  await recordAdminAction({
    action: decision === "restore" ? "member_photo_restore" : "member_photo_remove",
    targetType: "user",
    targetId: photo.owner_id,
    details: { photo_id: photoId, kind: photo.kind, report_count: photo.report_count, status: photo.status, reasons },
  });
  revalidatePath("/admin/moderation/photos");
  revalidatePath(`/profile/${photo.owner_id}`);
  return { ok: true };
}

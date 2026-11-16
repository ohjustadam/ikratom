"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { groupRemoval, isReportTarget, isTargetId } from "./types";

/**
 * Close every open report on one target (/admin/moderation/reports).
 *   dismissed — nothing wrong
 *   actioned  — the moderator dealt with it (in that surface's own tool;
 *               for wall posts, comments, and group posts, threads and events,
 *               this removes the item)
 * Member photos are resolved on /admin/moderation/photos instead, because
 * there the decision also restores or removes the photo itself.
 */
export async function resolveContentReports(
  targetType: string,
  targetId: string,
  decision: "dismissed" | "actioned",
): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) return { error: "Not authorized." };
  if (!isReportTarget(targetType) || !isTargetId(targetId) || (decision !== "dismissed" && decision !== "actioned")) {
    return { error: "Bad request." };
  }
  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("content_reports")
    .update({ status: decision, resolved_at: new Date().toISOString(), resolved_by: ctx.userId, resolution: decision })
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "open")
    .select("id, target_owner_id");
  if (error) return { error: "Could not update the reports." };

  // Wall posts and comments are acted on right here: "handled" removes the
  // item for good; "dismissed" restores one that 3 reports had auto-hidden.
  const wallTable = targetType === "wall_post" ? "wall_posts" : targetType === "wall_comment" ? "wall_comments" : null;
  if (wallTable) {
    const q = svc.from(wallTable).update({ status: decision === "actioned" ? "removed" : "active" }).eq("id", targetId);
    await (decision === "actioned" ? q.neq("status", "removed") : q.eq("status", "hidden"));
  }

  // A removed group post also stops serving its image (get_media_object).
  const removal = decision === "actioned" ? groupRemoval(targetType) : null;
  if (removal) {
    const { error: removeError } = await svc
      .from(removal.table)
      .update({ [removal.column]: new Date().toISOString() })
      .eq("id", targetId)
      .is(removal.column, null);
    if (removeError) return { error: "The reports closed, but the item is still up. Try again." };
  }

  await recordAdminAction({
    action: `content_report_${decision}`,
    targetType: "user",
    targetId: (data?.[0] as { target_owner_id?: string } | undefined)?.target_owner_id ?? undefined,
    details: { target_type: targetType, target_id: targetId, reports: data?.length ?? 0 },
  });
  revalidatePath("/admin/moderation/reports");
  revalidatePath("/admin/moderation");
  return { ok: true };
}

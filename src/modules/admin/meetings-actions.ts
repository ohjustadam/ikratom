"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

const VALID_STATUSES = ["pending_review", "approved", "rejected", "archived"] as const;
type Status = (typeof VALID_STATUSES)[number];

export async function listMeetingsForReview() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("municipal_meetings")
    .select("id, state, locality, body_name, meeting_at, format, zoom_url, livestream_url, agenda_url, agenda_text, source_url, ai_confidence, discovered_via, moderation_status, created_at")
    .in("moderation_status", ["pending_review", "approved"])
    .gte("meeting_at", new Date().toISOString())
    .order("meeting_at", { ascending: true })
    .limit(200);
  return data ?? [];
}

export async function setMeetingStatus(input: { id: string; status: string; note?: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!VALID_STATUSES.includes(input.status as Status)) return { error: "Invalid status." };

  const sb = await createClient();
  const { error } = await sb
    .from("municipal_meetings")
    .update({
      moderation_status: input.status,
      moderation_reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "municipal_meeting_moderated",
    targetType: "policy_alert",
    targetId: input.id,
    details: { status: input.status, note: input.note ?? null },
  });

  revalidatePath("/admin/meetings");
  revalidatePath("/calls");
  return { ok: true };
}

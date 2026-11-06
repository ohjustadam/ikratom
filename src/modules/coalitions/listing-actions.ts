"use server";

import { revalidatePath } from "next/cache";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * A moderator's decision on a group waiting to be listed (migration 0313).
 * Approving lists it. Declining leaves it private and working; the organizer
 * can fix the wording and ask again.
 */
export async function decideGroupListing(coalitionId: string, approve: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) return { ok: false, error: "Moderators only." };
  if (!UUID_RE.test(coalitionId)) return { ok: false, error: "Not found." };

  const admin = createServiceRoleClient();
  const { data, error } = await admin.from("coalitions")
    .update(approve ? { listing_approved_at: new Date().toISOString(), is_public: true } : { listing_requested_at: null })
    .eq("id", coalitionId).not("listing_requested_at", "is", null).is("listing_approved_at", null)
    .select("slug, name");
  if (error) return { ok: false, error: "Couldn't save that." };
  const group = data?.[0];
  if (!group) return { ok: false, error: "Already decided." };

  const { data: organizers } = await admin.from("coalition_members").select("user_id").eq("coalition_id", coalitionId).in("role", ["owner", "admin"]);
  if (organizers?.length) {
    await admin.from("notifications").insert(organizers.map((o) => ({
      user_id: o.user_id, kind: "group_listing_review",
      title: approve ? `${group.name} is now listed` : `${group.name} wasn't listed`,
      body: approve
        ? "It shows in the group directory, and people can ask to join."
        : "It stays private and your group link still works. Check the name and About, then ask again.",
      link: `/coalitions/${group.slug}?tab=about`,
    }))).then(() => {}, () => {});
  }

  await recordAdminAction({ action: approve ? "group.listing_approved" : "group.listing_declined", targetId: coalitionId, details: { name: group.name } });
  revalidatePath("/coalitions");
  revalidatePath(`/coalitions/${group.slug}`);
  revalidatePath("/admin/moderation/groups");
  return { ok: true };
}

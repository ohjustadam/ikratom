import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * New public groups wait for a moderator (owner, 2026-11-05; migration 0313).
 * is_public still means "listed", so nothing that reads it changes: asking to
 * go public records listing_requested_at and a trigger keeps the group private
 * until a moderator approves it in /admin/moderation/groups. The group and its
 * invite link work the whole time.
 */
export type ListingFields = { is_public: boolean; listing_requested_at: string | null; listing_approved_at: string | null };

export function listingPending(g: ListingFields): boolean {
  return !g.is_public && !!g.listing_requested_at && !g.listing_approved_at;
}

/** Tell the moderators a group is waiting. A failed notice must never fail the organizer's save. */
export async function tellModeratorsGroupWaiting(admin: SupabaseClient, name: string): Promise<void> {
  const { data } = await admin.from("profiles").select("id").or("is_admin.eq.true,is_owner.eq.true");
  if (!data?.length) return;
  await admin.from("notifications").insert(data.map((p) => ({
    user_id: p.id, kind: "group_listing_review",
    title: `New group waiting: ${name}`, body: "Check it before it's listed publicly.", link: "/admin/moderation/groups",
  }))).then(() => {}, () => {});
}

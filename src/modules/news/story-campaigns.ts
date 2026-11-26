import type { SupabaseClient } from "@supabase/supabase-js";

export type LiveCampaign = { slug: string; title: string };

/**
 * What a member can do about a story right now: its bill's live campaigns
 * first; failing that, the live campaigns in its state. Public rows only
 * (active = true), so any client may call it. Shared by the tip form's link
 * check (#1194) and the smart link box.
 */
export async function liveCampaignsFor(
  sb: SupabaseClient,
  at: { billId?: string | null; state?: string | null },
  limit = 3,
): Promise<LiveCampaign[]> {
  const live = () =>
    sb.from("campaigns").select("slug, title").eq("active", true).order("created_at", { ascending: false }).limit(limit);
  if (at.billId) {
    const { data } = await live().eq("bill_id", at.billId);
    if (data?.length) return data as LiveCampaign[];
  }
  if (at.state && /^[A-Z]{2}$/.test(at.state)) {
    const { data } = await live().eq("state", at.state);
    if (data?.length) return data as LiveCampaign[];
  }
  return [];
}

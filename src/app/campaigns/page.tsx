import { createClient } from "@/lib/supabase/server";
import { CampaignBrowser } from "./CampaignBrowser";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const supabase = await createClient();

  const [{ data: campaigns }, { data: { user } }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, active")
      .eq("active", true)
      .order("created_at", { ascending: false }),
    supabase.auth.getUser(),
  ]);

  let userState: string | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;
  }

  // Per-campaign action counts (for social proof)
  const ids = (campaigns ?? []).map((c) => c.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: actionRows } = await supabase
      .from("campaign_actions")
      .select("campaign_id")
      .in("campaign_id", ids);
    for (const r of actionRows ?? []) {
      counts[r.campaign_id] = (counts[r.campaign_id] ?? 0) + 1;
    }
  }

  return (
    <CampaignBrowser
      campaigns={campaigns ?? []}
      userState={userState}
      actionCounts={counts}
    />
  );
}

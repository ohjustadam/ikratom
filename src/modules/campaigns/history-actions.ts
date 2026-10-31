"use server";
import { createClient } from "@/lib/supabase/server";

/** When the signed-in member last sent each campaign, and how many emails in all. */
export type MyCampaignHistory = Record<string, { last: string; sends: number }>;

/**
 * The member's own campaign record, one entry per campaign they have sent.
 * /campaigns is a cached public page, so it asks for this from the browser
 * after load instead of reading cookies on the server (see page.tsx). Signed
 * out is an empty record, never an error.
 */
export async function getMyCampaignHistory(): Promise<MyCampaignHistory> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  // RLS (actions_self_read) limits the function to the caller's own rows.
  const { data, error } = await supabase.rpc("my_campaign_history");
  if (error || !data) return {};

  const out: MyCampaignHistory = {};
  for (const r of data as { campaign_id: string; last_sent_at: string; sends: number }[]) {
    out[r.campaign_id] = { last: r.last_sent_at, sends: Number(r.sends) };
  }
  return out;
}

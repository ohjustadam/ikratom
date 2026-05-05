"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";
import { requireMfaForMutation } from "@/modules/admin/mfa";
import { recordAdminAction } from "@/lib/audit";

/**
 * Admin-only wave operations: retry failed signups, list past waves.
 */

/**
 * Reset specified signup rows from 'failed' or 'skipped' back to
 * 'pending' so the next cron tick re-attempts them.
 *
 * Common case: a wave fired but Gmail rate-limited a few users; their
 * tokens have since refreshed. Admin retries those specific failures.
 */
export async function retryWaveFailures(input: {
  waveId: string;
  signupIds?: string[]; // optional — defaults to ALL failed/skipped
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  // Need to flip the wave back to active if it was marked fired
  const { data: wave } = await supabase
    .from("campaign_waves")
    .select("id, campaign_id, fired_at")
    .eq("id", input.waveId)
    .single();
  if (!wave) return { error: "Wave not found." };

  // Reset selected (or all eligible) signups
  let q = supabase
    .from("campaign_wave_signups")
    .update({ send_status: "pending", send_error: null, sent_at: null })
    .eq("wave_id", input.waveId)
    .in("send_status", ["failed", "skipped"]);

  if (input.signupIds && input.signupIds.length > 0) {
    q = q.in("id", input.signupIds);
  }

  const { error: updateErr, data: updated } = await q.select("id");
  if (updateErr) return { error: updateErr.message };

  // If we reset anything, the wave needs to be unfired so the cron picks
  // it up again. Decrement the failed_count by how many we reset.
  const resetCount = updated?.length ?? 0;
  if (resetCount > 0 && wave.fired_at) {
    const { data: current } = await supabase
      .from("campaign_waves")
      .select("failed_count")
      .eq("id", input.waveId)
      .single();
    await supabase
      .from("campaign_waves")
      .update({
        fired_at: null,
        failed_count: Math.max(0, (current?.failed_count ?? 0) - resetCount),
      })
      .eq("id", input.waveId);
  }

  await recordAdminAction({
    action: "wave_retry",
    targetType: "campaign",
    targetId: wave.campaign_id,
    details: { wave_id: wave.id, reset_count: resetCount },
  });

  revalidatePath(`/admin/campaigns/${wave.campaign_id}/waves/${wave.id}`);
  return { ok: true, count: resetCount };
}

export type WaveSummary = {
  id: string;
  title: string;
  scheduled_at: string;
  fired_at: string | null;
  active: boolean;
  sent_count: number;
  failed_count: number;
  signup_count: number;
};

export async function listWavesForCampaign(campaignId: string): Promise<WaveSummary[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin && !profile?.is_owner && !profile?.is_advocate_leader) return [];

  const { data: waves } = await supabase
    .from("campaign_waves")
    .select("id, title, scheduled_at, fired_at, active, sent_count, failed_count")
    .eq("campaign_id", campaignId)
    .order("scheduled_at", { ascending: false });

  if (!waves) return [];

  // Pull signup counts for each wave (one query, group in memory)
  const waveIds = waves.map((w) => w.id);
  const { data: signups } = waveIds.length > 0
    ? await supabase
        .from("campaign_wave_signups")
        .select("wave_id")
        .in("wave_id", waveIds)
    : { data: [] };

  const counts = new Map<string, number>();
  for (const s of (signups ?? []) as { wave_id: string }[]) {
    counts.set(s.wave_id, (counts.get(s.wave_id) ?? 0) + 1);
  }

  return waves.map((w) => ({
    id: w.id,
    title: w.title,
    scheduled_at: w.scheduled_at,
    fired_at: w.fired_at,
    active: w.active,
    sent_count: w.sent_count,
    failed_count: w.failed_count,
    signup_count: counts.get(w.id) ?? 0,
  }));
}

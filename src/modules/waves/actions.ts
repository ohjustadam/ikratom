"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";
import { requireMfaForMutation, requireMfaEnrolled } from "@/modules/admin/mfa";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { accountAgeOk } from "@/modules/auth/trust-tier";

/**
 * Coordinated wave sends — coalition mode.
 *
 * Lifecycle:
 *   1. Creator (admin / leader) calls `createWave(campaignId, scheduledAt, ...)`
 *   2. Users browse to /campaigns/<slug>, see the active wave, join
 *   3. At scheduled_at, /api/cron/fire-waves picks the wave up and sends
 *      every joined user's pre-personalized email via their connected Gmail
 *   4. Each signup row gets send_status='sent' or 'failed' with an error
 *   5. Wave row gets fired_at + sent_count + failed_count
 */

export type CreateWaveInput = {
  campaignId: string;
  title: string;
  description?: string;
  scheduledAt: string; // ISO timestamp
  targetSignups?: number | null;
};

export async function createWave(input: CreateWaveInput) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Sign in as an admin or advocate leader to create a wave." };
  // MFA mandatory for leader authoring (PR4); admins/owner keep the soft gate.
  const mfaErr = ctx.isLeader && !ctx.isAdmin && !ctx.isOwner
    ? requireMfaEnrolled(ctx)
    : requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };
  // Defense-in-depth: bound wave creation even for a (compromised) leader.
  if (!(await checkRateLimit(`wave:create:${ctx.userId}`, 30, 3600))) {
    return { error: "Too many waves created this hour — slow down." };
  }

  const title = (input.title || "").trim().slice(0, 200);
  if (!title) return { error: "Title is required." };
  const description = input.description ? input.description.slice(0, 1000) : null;

  const scheduledAt = new Date(input.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return { error: "Invalid scheduled time." };
  if (scheduledAt.getTime() < Date.now() + 5 * 60 * 1000) {
    return { error: "Wave must be scheduled at least 5 minutes from now." };
  }
  if (scheduledAt.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
    return { error: "Wave can't be scheduled more than 90 days out." };
  }

  const targetSignups =
    typeof input.targetSignups === "number" && input.targetSignups > 0
      ? Math.min(10000, Math.floor(input.targetSignups))
      : null;

  const supabase = await createClient();

  // Verify campaign exists + is active. Pull the template + targets too so
  // we can SNAPSHOT them onto the wave — fire time must use what existed at
  // wave creation, not a (possibly tampered) live template (mig 0204).
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, active, state, subject_template, body_template, target_legislator_ids, target_roles")
    .eq("id", input.campaignId)
    .single();
  if (!campaign) return { error: "Campaign not found." };
  if (!campaign.active) return { error: "Campaign is not active." };

  const { data: row, error } = await supabase
    .from("campaign_waves")
    .insert({
      campaign_id: campaign.id,
      title,
      description,
      scheduled_at: scheduledAt.toISOString(),
      target_signups: targetSignups,
      created_by: ctx.userId,
      // Freeze the message + targets at creation — anti-tamper (mig 0204).
      subject_template_snapshot: campaign.subject_template,
      body_template_snapshot: campaign.body_template,
      target_legislator_ids_snapshot: campaign.target_legislator_ids,
      target_roles_snapshot: campaign.target_roles,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return {
        error:
          "There's already an active wave for this campaign. Cancel the existing one first.",
      };
    }
    return { error: error.message };
  }

  await recordAdminAction({
    action: "wave_created",
    targetType: "campaign",
    targetId: campaign.id,
    details: { wave_id: row.id, scheduled_at: scheduledAt.toISOString(), target_signups: targetSignups },
  });

  revalidatePath(`/campaigns/${campaign.slug}`);
  return { ok: true, waveId: row.id };
}

export async function joinWave(waveId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to join a wave." };

  // Anti-Sybil moat (PR4): coordinated waves are an amplification surface, so
  // a brand-new account can't join one until it's 48h old. Basic "email your
  // reps" stays open immediately — only amplification is gated.
  if (!accountAgeOk(user.created_at)) {
    return { error: "New accounts can join coordinated waves 48 hours after signing up. In the meantime you can email your legislators directly right now." };
  }

  // Verify the wave is still joinable
  const { data: wave } = await supabase
    .from("campaign_waves")
    .select("id, scheduled_at, fired_at, active")
    .eq("id", waveId)
    .single();
  if (!wave) return { error: "Wave not found." };
  if (!wave.active) return { error: "This wave was cancelled." };
  if (wave.fired_at) return { error: "This wave has already fired." };
  if (new Date(wave.scheduled_at).getTime() <= Date.now()) {
    return { error: "Too late — this wave is firing now." };
  }

  // Require Gmail connected — wave fires from each user's own Gmail
  const { data: integration } = await supabase
    .from("email_integrations")
    .select("account_email")
    .eq("user_id", user.id)
    .eq("provider", "gmail")
    .maybeSingle();
  if (!integration) {
    return {
      error:
        "Connect your Gmail at /account first — waves send from your own account.",
    };
  }

  const { error } = await supabase
    .from("campaign_wave_signups")
    .insert({ wave_id: waveId, user_id: user.id });
  if (error) {
    if (error.code === "23505") {
      return { error: "You're already in this wave." };
    }
    return { error: error.message };
  }

  return { ok: true };
}

export async function leaveWave(waveId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Block leaving after the wave has fired
  const { data: wave } = await supabase
    .from("campaign_waves")
    .select("fired_at")
    .eq("id", waveId)
    .single();
  if (wave?.fired_at) return { error: "Wave has already fired — can't leave now." };

  const { error } = await supabase
    .from("campaign_wave_signups")
    .delete()
    .eq("wave_id", waveId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Cancel an unfired wave. Creator/admin only. */
export async function cancelWave(waveId: string) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin or leader only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { error: mfaErr };

  const supabase = await createClient();
  const { data: wave } = await supabase
    .from("campaign_waves")
    .select("id, campaign_id, fired_at, created_by")
    .eq("id", waveId)
    .single();
  if (!wave) return { error: "Wave not found." };
  if (wave.fired_at) return { error: "Wave already fired." };
  if (wave.created_by !== ctx.userId && !ctx.isAdmin && !ctx.isOwner) {
    return { error: "Only the wave creator or an admin can cancel this." };
  }

  const { error } = await supabase
    .from("campaign_waves")
    .update({ active: false })
    .eq("id", waveId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "wave_cancelled",
    targetType: "campaign",
    targetId: wave.campaign_id,
    details: { wave_id: wave.id },
  });

  return { ok: true };
}

/** Returns whether the current user is signed up to this wave. */
export async function getMyWaveStatus(waveId: string): Promise<{
  joined: boolean;
  status: "pending" | "sent" | "failed" | "skipped" | "opted_out" | null;
}> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { joined: false, status: null };

  const { data } = await supabase
    .from("campaign_wave_signups")
    .select("send_status")
    .eq("wave_id", waveId)
    .eq("user_id", user.id)
    .maybeSingle();
  return {
    joined: !!data,
    status: (data?.send_status as "pending" | "sent" | "failed" | "skipped" | "opted_out" | null) ?? null,
  };
}

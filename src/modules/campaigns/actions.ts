"use server";

import { createClient } from "@/lib/supabase/server";
import { getGmailIntegration, sendViaGmail } from "@/lib/email/gmail";
import { renderTemplate, buildVars } from "./templates";
import type { Legislator } from "@/lib/legislators";

/**
 * Log a campaign action — one row per legislator the user contacted.
 * Called after the user clicks "Send" on the campaign action UI.
 *
 * Intent-based logging: we log when the user commits to send (opens mailto),
 * even if the email client send isn't 100% confirmable. The platform value
 * is in the activation, not the deliverability — that's the user's job.
 */
// Spam prevention thresholds
const RESEND_COOLDOWN_HOURS = 24 * 7; // 1 week — same campaign + same legislator
const DAILY_SEND_CAP = 100;            // total actions per user per 24h
const PER_CAMPAIGN_DAILY_CAP = 1;      // max one send per campaign per user per day (prevents accidental re-sends)

/**
 * Returns the legislator IDs the user has already contacted for this campaign
 * within the cooldown window — caller filters them out before sending.
 */
async function getRecentlySentTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  campaignId: string,
): Promise<Set<string>> {
  const since = new Date(Date.now() - RESEND_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("campaign_actions")
    .select("legislator_id")
    .eq("user_id", userId)
    .eq("campaign_id", campaignId)
    .gte("sent_at", since);
  return new Set((data ?? []).map((r) => r.legislator_id));
}

async function getDailyActionCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("sent_at", since);
  return count ?? 0;
}

/**
 * Per-campaign progress for the signed-in user — used by the page to show
 * "you've already sent" badges before the user clicks anything.
 */
export async function getMyCampaignProgress(campaignId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { sentLegislatorIds: [] as string[], lastSentAt: null as string | null };

  const since = new Date(Date.now() - RESEND_COOLDOWN_HOURS * 3600 * 1000).toISOString();
  const { data } = await supabase
    .from("campaign_actions")
    .select("legislator_id, sent_at")
    .eq("user_id", user.id)
    .eq("campaign_id", campaignId)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false });

  const lastSentAt = data?.[0]?.sent_at ?? null;
  const sentLegislatorIds = Array.from(new Set((data ?? []).map((r) => r.legislator_id)));
  return { sentLegislatorIds, lastSentAt };
}

export async function logCampaignAction(input: {
  campaignId: string;
  legislatorIds: string[];
  method: "mailto" | "platform_email" | "call";
  subject?: string;
  body?: string;
  isNonResident?: boolean;
}) {
  const { campaignId, legislatorIds, method, subject, body, isNonResident } = input;
  if (!campaignId || legislatorIds.length === 0) return { error: "Missing inputs." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Daily cap
  const dailyCount = await getDailyActionCount(supabase, user.id);
  if (dailyCount >= DAILY_SEND_CAP) {
    return { error: `Daily cap reached (${DAILY_SEND_CAP} sends per 24h). Try again tomorrow.` };
  }

  // Skip targets already contacted for this campaign in the cooldown window
  const alreadySent = await getRecentlySentTargets(supabase, user.id, campaignId);
  const newTargets = legislatorIds.filter((id) => !alreadySent.has(id));

  if (newTargets.length === 0) {
    return { error: `Already sent this campaign to all selected legislators in the last ${Math.round(RESEND_COOLDOWN_HOURS / 24)} days.` };
  }

  const rows = newTargets.map((lid) => ({
    user_id: user.id,
    campaign_id: campaignId,
    legislator_id: lid,
    method,
    subject: subject?.slice(0, 200) ?? null,
    body: body?.slice(0, 5000) ?? null,
    is_non_resident: !!isNonResident,
  }));

  const { error } = await supabase.from("campaign_actions").insert(rows);
  if (error) return { error: error.message };
  return { count: rows.length, skipped: legislatorIds.length - rows.length };
}

/**
 * One-click batch send via the user's connected Gmail account.
 * For each legislator, we render the template with their name + the user's profile,
 * then send a personalized email. Each lands in the user's Sent folder.
 *
 * Returns per-legislator results so the UI can show progress.
 */
export async function sendCampaignViaGmail(input: {
  campaignId: string;
  subject: string;
  bodyTemplate: string;
  targetIds: string[];
  isNonResident?: boolean;
}): Promise<
  | { ok: true; sent: number; failed: number; skippedAlreadySent: number; results: { id: string; ok: boolean; error?: string }[] }
  | { error: string }
> {
  const { campaignId, subject, bodyTemplate, targetIds, isNonResident } = input;
  if (!campaignId || targetIds.length === 0) return { error: "No targets." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Profile for from-name + template vars
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, street, city, state, zip")
    .eq("id", user.id)
    .single();

  // Gmail integration
  const integration = await getGmailIntegration(user.id);
  if (!integration) return { error: "Gmail not connected. Connect in /account first." };

  // Daily cap check
  const dailyCount = await getDailyActionCount(supabase, user.id);
  if (dailyCount >= DAILY_SEND_CAP) {
    return { error: `Daily cap reached (${DAILY_SEND_CAP} sends per 24h). Try again tomorrow.` };
  }

  // Filter out targets already sent within the cooldown window
  const alreadySent = await getRecentlySentTargets(supabase, user.id, campaignId);
  const freshTargetIds = targetIds.filter((id) => !alreadySent.has(id));

  if (freshTargetIds.length === 0) {
    return {
      error: `You already sent this campaign to all selected legislators in the last ${Math.round(RESEND_COOLDOWN_HOURS / 24)} days. To prevent spam, we don't allow re-sending to the same officials in that window.`,
    };
  }

  // Targets — only fresh ones
  const { data: targets } = await supabase
    .from("legislators")
    .select("id,state,role,district,full_name,party,email,phone,office_address,website,level,locality,body,title")
    .in("id", freshTargetIds)
    .eq("active", true);

  const validTargets = ((targets ?? []) as Legislator[]).filter(
    (t): t is Legislator & { email: string } =>
      !!t.email && !t.email.startsWith("http") // skip contact-form-only
  );

  if (validTargets.length === 0) {
    return { error: "None of the selected targets have a sendable email." };
  }

  // Cap how many we'll send in this batch by remaining daily quota
  const remainingDaily = DAILY_SEND_CAP - dailyCount;
  if (validTargets.length > remainingDaily) {
    validTargets.length = remainingDaily;
  }

  const skippedAlreadySent = targetIds.length - freshTargetIds.length;

  const results: { id: string; ok: boolean; error?: string }[] = [];
  const successfulIds: string[] = [];

  // Send sequentially to stay polite with Gmail rate limits + readable progress
  for (const t of validTargets) {
    try {
      const vars = buildVars(profile, t, validTargets);
      const personalizedBody = renderTemplate(bodyTemplate, vars);

      await sendViaGmail({
        refreshToken: integration.refresh_token,
        fromName: profile?.full_name ?? null,
        fromEmail: integration.account_email,
        to: t.email,
        subject,
        body: personalizedBody,
      });

      results.push({ id: t.id, ok: true });
      successfulIds.push(t.id);
    } catch (e) {
      results.push({ id: t.id, ok: false, error: (e as Error).message });
    }
  }

  // Log successful sends to campaign_actions
  if (successfulIds.length > 0) {
    const rows = successfulIds.map((lid) => ({
      user_id: user.id,
      campaign_id: campaignId,
      legislator_id: lid,
      method: "platform_email" as const,
      subject: subject.slice(0, 200),
      body: bodyTemplate.slice(0, 5000),
      is_non_resident: !!isNonResident,
    }));
    await supabase.from("campaign_actions").insert(rows);
  }

  // Update last_used_at
  const adminCheck = results.some((r) => r.ok);
  if (adminCheck) {
    await supabase
      .from("email_integrations")
      .update({ last_used_at: new Date().toISOString() })
      .eq("user_id", user.id);
  }

  return {
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skippedAlreadySent,
    results,
  };
}

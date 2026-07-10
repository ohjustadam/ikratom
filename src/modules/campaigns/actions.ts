"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, releaseRateLimit } from "@/lib/rate-limit";
import {
  getEmailIntegration,
  sendOnUserBehalf,
  EmailTokenRevokedError,
  markEmailIntegrationRevoked,
} from "@/lib/email/user-send";
import { renderTemplate, buildVars } from "./templates";
import type { Legislator } from "@/lib/legislators";
import {
  legislatorInCampaignScope,
  filterIdsInCampaignScope,
  type CampaignScope,
} from "./scope";

/**
 * Read the embed referral cookie set by the proxy when a user arrived
 * via the embed widget. Returns null if no cookie is present. Value is
 * the embedding site's hostname (lowercase, ascii-only, capped at 80
 * chars by the proxy regex).
 */
async function getEmbedRef(): Promise<string | null> {
  try {
    const c = await cookies();
    const v = c.get("embed_ref")?.value;
    return v && v.length > 0 && v.length < 100 ? v : null;
  } catch {
    return null;
  }
}

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
    // CAMPAIGN cap only — direct (non-campaign) compose sends carry a null
    // campaign_id (migration 0232) and must not consume the campaign quota.
    .not("campaign_id", "is", null)
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

/**
 * Load the campaign's recipient-scope fields for server-side membership
 * validation. Returns null if the campaign doesn't exist.
 */
async function loadCampaignScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaignId: string,
): Promise<CampaignScope | null> {
  const { data } = await supabase
    .from("campaigns")
    .select("target_legislator_ids, target_roles, state, target_locality")
    .eq("id", campaignId)
    .maybeSingle();
  return (data ?? null) as CampaignScope | null;
}

/**
 * Re-derive a campaign's allowed recipients server-side and return the subset
 * of `candidateIds` that are in scope. Mirrors campaigns/[slug]/page.tsx so a
 * crafted id array can't repurpose a campaign to reach arbitrary officials.
 * For role-based campaigns this loads the candidates' role/state/locality.
 */
async function scopeIdsToCampaign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  campaign: CampaignScope,
  candidateIds: string[],
): Promise<string[]> {
  // Explicit-target campaigns are a pure ID-set intersection — no row load.
  if (campaign.target_legislator_ids && campaign.target_legislator_ids.length > 0) {
    return filterIdsInCampaignScope(candidateIds, [], campaign);
  }
  const { data: legRows } = await supabase
    .from("legislators")
    .select("id, role, state, locality")
    .in("id", candidateIds);
  return filterIdsInCampaignScope(
    candidateIds,
    (legRows ?? []) as Array<{ id: string; role: string; state: string | null; locality: string | null }>,
    campaign,
  );
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

  // Read-only mode gate (admins bypass).
  const { assertNotReadOnly } = await import("@/lib/read-only-mode");
  const ro = await assertNotReadOnly();
  if (ro) return { error: ro };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Membership guard (defense-in-depth): only log actions to officials that
  // actually belong to this campaign's scope. The action otherwise trusts a
  // client-supplied id array; this re-derives the allowed set server-side.
  const campaign = await loadCampaignScope(supabase, campaignId);
  if (!campaign) return { error: "Campaign not found." };
  const scopedIds = await scopeIdsToCampaign(supabase, campaign, legislatorIds);
  if (scopedIds.length === 0) {
    return { error: "None of the selected officials are part of this campaign." };
  }

  // Daily cap
  const dailyCount = await getDailyActionCount(supabase, user.id);
  if (dailyCount >= DAILY_SEND_CAP) {
    return { error: `Daily cap reached (${DAILY_SEND_CAP} sends per 24h). Try again tomorrow.` };
  }

  // Skip targets already contacted for this campaign in the cooldown window
  const alreadySent = await getRecentlySentTargets(supabase, user.id, campaignId);
  const newTargets = scopedIds.filter((id) => !alreadySent.has(id));

  if (newTargets.length === 0) {
    return { error: `Already sent this campaign to all selected legislators in the last ${Math.round(RESEND_COOLDOWN_HOURS / 24)} days.` };
  }

  // Atomic daily-cap reservation (TOCTOU-safe): reserve one unit per action via
  // the atomic checkRateLimit counter, so N concurrent calls can't each pass the
  // advisory dailyCount read above and collectively blow past DAILY_SEND_CAP.
  const reserved: string[] = [];
  for (const id of newTargets) {
    if (!(await checkRateLimit(`campaign:send:user:${user.id}`, DAILY_SEND_CAP, 86400))) break;
    reserved.push(id);
  }
  if (reserved.length === 0) {
    return { error: `Daily cap reached (${DAILY_SEND_CAP} sends per 24h). Try again tomorrow.` };
  }

  const referredFrom = await getEmbedRef();

  const rows = reserved.map((lid) => ({
    user_id: user.id,
    campaign_id: campaignId,
    legislator_id: lid,
    method,
    subject: subject?.slice(0, 200) ?? null,
    body: body?.slice(0, 5000) ?? null,
    is_non_resident: !!isNonResident,
    referred_from: referredFrom,
  }));

  const { error } = await supabase.from("campaign_actions").insert(rows);
  if (error) {
    // Refund the daily-cap units we reserved for a batch that never committed,
    // so a transient insert error doesn't silently eat the user's quota.
    await releaseRateLimit(`campaign:send:user:${user.id}`, reserved.length);
    return { error: error.message };
  }
  // Achievement points accrue automatically via the campaign_actions insert
  // trigger (Academy P1, migration 0236) — no award call needed here.
  return { count: rows.length, skipped: scopedIds.length - rows.length };
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

  // Membership guard (defense-in-depth): re-derive this campaign's allowed
  // recipients server-side so a crafted targetIds array can't email officials
  // outside the campaign's scope. Applied to the loaded target rows below.
  const campaign = await loadCampaignScope(supabase, campaignId);
  if (!campaign) return { error: "Campaign not found." };

  // Profile for from-name + template vars
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, street, city, state, zip")
    .eq("id", user.id)
    .single();

  // Connected email provider (Gmail or Outlook — whichever the user
  // OAuth'd with last). Unified dispatcher dispatches to the right
  // adapter at send time.
  const integration = await getEmailIntegration(user.id);
  if (!integration) return { error: "No email provider connected. Connect Gmail or Outlook in /account first." };

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

  // Drop any target not in the campaign's scope before sending.
  const scopedTargets = ((targets ?? []) as Legislator[]).filter((t) =>
    legislatorInCampaignScope(t, campaign),
  );
  if (scopedTargets.length === 0) {
    return { error: "None of the selected officials are part of this campaign." };
  }

  const validTargets = scopedTargets.filter(
    (t): t is Legislator & { email: string } =>
      !!t.email && !t.email.startsWith("http") // skip contact-form-only
  );

  if (validTargets.length === 0) {
    return { error: "None of the selected targets have a sendable email." };
  }

  const skippedAlreadySent = targetIds.length - freshTargetIds.length;

  const results: { id: string; ok: boolean; error?: string }[] = [];
  const successfulIds: string[] = [];

  // Send sequentially to stay polite with provider rate limits + readable progress
  let tokenRevoked = false;
  let capReached = false;
  for (const t of validTargets) {
    // Atomic daily-cap reservation per email. The dailyCount read above is
    // advisory (N concurrent batches could all pass it before any row commits —
    // TOCTOU), so reserve each send against the atomic checkRateLimit counter;
    // concurrent sends then can't collectively exceed DAILY_SEND_CAP. Stop the
    // batch once the cap is hit rather than dispatching real email past it.
    if (!(await checkRateLimit(`campaign:send:user:${user.id}`, DAILY_SEND_CAP, 86400))) {
      capReached = true;
      break;
    }
    try {
      const vars = buildVars(profile, t, validTargets);
      const personalizedBody = renderTemplate(bodyTemplate, vars);

      await sendOnUserBehalf({
        integration,
        fromName: profile?.full_name ?? null,
        to: t.email,
        subject,
        body: personalizedBody,
      });

      results.push({ id: t.id, ok: true });
      successfulIds.push(t.id);
    } catch (e) {
      results.push({ id: t.id, ok: false, error: (e as Error).message });
      // Refund the daily-cap unit reserved for this send that never went out.
      await releaseRateLimit(`campaign:send:user:${user.id}`, 1);
      // Self-healing: if the user has revoked our access OR the token
      // has gone stale, mark the integration so the UI shows the
      // Connect CTA again. No point continuing the batch — every
      // remaining send will fail the same way.
      if (e instanceof EmailTokenRevokedError) {
        tokenRevoked = true;
        await markEmailIntegrationRevoked(user.id, e.provider);
        break;
      }
    }
  }
  if (tokenRevoked) {
    return { error: "Your email connection expired or was revoked. Reconnect in /account to resume one-click send." };
  }
  if (capReached && successfulIds.length === 0) {
    return { error: `Daily cap reached (${DAILY_SEND_CAP} sends per 24h). Try again tomorrow.` };
  }

  // Log successful sends to campaign_actions
  if (successfulIds.length > 0) {
    const referredFrom = await getEmbedRef();
    const rows = successfulIds.map((lid) => ({
      user_id: user.id,
      campaign_id: campaignId,
      legislator_id: lid,
      method: "platform_email" as const,
      subject: subject.slice(0, 200),
      body: bodyTemplate.slice(0, 5000),
      is_non_resident: !!isNonResident,
      referred_from: referredFrom,
    }));
    await supabase.from("campaign_actions").insert(rows);
    // Points accrue via the campaign_actions insert trigger (mig 0236).
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

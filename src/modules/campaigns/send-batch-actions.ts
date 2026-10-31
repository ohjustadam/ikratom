"use server";

/**
 * Server actions for the durable send queue (migration 0248).
 *
 * These are the ONLY writers to campaign_send_batches / _items from user
 * space — both tables are SELECT-only under RLS. That is deliberate: this
 * queue drives real email out of the user's OWN mailbox, so if a browser could
 * insert rows, iKratom would be a free spam relay wearing that user's From:
 * address.
 *
 * The rule every function here obeys: the browser may say WHICH of the
 * campaign's officials to write to, never WHO those officials are or what
 * address they have. Recipients and addresses are always re-derived from the
 * database and re-checked against the campaign's own scope.
 */

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getEmailIntegration } from "@/lib/email/user-send";
import { resolveLimits, planParts, type ProviderTier } from "@/lib/email/provider-limits";
import { legislatorInCampaignScope } from "./scope";
import { checkRateLimit } from "@/lib/rate-limit";
import { adaptForHiddenHome, adaptForNonResident, buildVars, renderTemplate, unfilledPlaceholders } from "./templates";
import { getSafeMode } from "./safe-mode";
import { drainBatch } from "./drain-batch";
import { screenMemberLetter } from "./screen-content";

/** Hard ceiling on one batch. Not a security boundary — scope is. */
const MAX_BATCH_RECIPIENTS = 1000;
/** Caps on a user-written letter. Generous; a real letter is ~2-4 KB. */
const MAX_SUBJECT = 300;
const MAX_BODY = 12_000;

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type EnqueueResult =
  | {
      ok: true;
      batchId: string;
      total: number;
      skippedOutOfScope: number;
      skippedNoEmail: number;
      skippedAlreadySent: number;
      parts: { part: number; count: number; sameDay: boolean }[];
      providerLabel: string;
      effectiveDaily: number;
      remainingToday: number;
    }
  | { ok: false; error: string };

/**
 * Queue a campaign send. Returns immediately — the worker
 * (/api/cron/drain-send-batches) delivers, so the send survives the tab that
 * started it.
 */
export async function enqueueCampaignSend(input: {
  campaignSlug: string;
  legislatorIds: string[];
  /**
   * The subject and letter exactly as the user left them in the composer:
   * sender fields filled, per-recipient fields still {{placeholders}}. When
   * omitted, the campaign's own template is used. Before 2026-10-21 one-click
   * always sent the template, so a user's edits were silently thrown away.
   */
  subject?: string;
  body?: string;
}): Promise<EnqueueResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to send." };

  // One enqueue per 10s per user. Cheap guard against a double-click creating
  // two batches for the same selection; the per-recipient UNIQUE constraint is
  // what actually prevents duplicate mail.
  if (!(await checkRateLimit(`campaign:enqueue:${user.id}`, 3, 10))) {
    return { ok: false, error: "Slow down a moment — you just queued a send." };
  }

  const ids = [...new Set(input.legislatorIds)]
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, MAX_BATCH_RECIPIENTS);
  if (ids.length === 0) return { ok: false, error: "Pick at least one recipient." };

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, target_locality, target_roles, target_legislator_ids, subject_template, body_template, active")
    .eq("slug", input.campaignSlug)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found." };
  if (!campaign.active) return { ok: false, error: "This campaign is no longer active." };

  const integration = await getEmailIntegration(user.id);
  if (!integration) {
    // Queued bulk send is only possible through a connected account: a mailto:
    // or web-compose link opens ONE compose window and cannot loop N
    // individual messages. This is a real capability difference, not a nag.
    return {
      ok: false,
      error: "Connect Gmail or Outlook in /account to send in the background. Without it you can still send to your own reps one at a time.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("email_provider_tier, full_name, username, street, city, county, state, zip, banned_state_safe_mode")
    .eq("id", user.id)
    .maybeSingle();

  // The letter to send. The user's own words when given; otherwise the
  // campaign template, made true for an out-of-area sender ("I am a
  // constituent" from Mississippi to Oklahoma is a false statement).
  const custom = typeof input.body === "string" && input.body.trim() !== "";
  let subjectTpl = custom ? String(input.subject ?? "").trim() : campaign.subject_template;
  let bodyTpl = custom ? String(input.body) : campaign.body_template;
  if (custom) {
    if (!subjectTpl) return { ok: false, error: "Add a subject line before sending." };
    if (subjectTpl.length > MAX_SUBJECT || bodyTpl.length > MAX_BODY) {
      return { ok: false, error: "That message is too long to send. Trim it and try again." };
    }
    // The member's own words leave through iKratom, so they are screened here,
    // where it can't be skipped (owner rules, 2026-10-22; see screen-content.ts).
    const screen = await screenMemberLetter({ subject: subjectTpl, body: bodyTpl });
    if (screen.block) {
      return { ok: false, error: `${screen.message} If you think this is a mistake, contact us at /support.` };
    }
  } else {
    const nonResident = !!campaign.state && !!profile?.state && profile.state !== campaign.state;
    if (nonResident) {
      // Banned-state safe mode (0275): out-of-state officials get no home at all.
      const safeMode = await getSafeMode(supabase, profile?.state, profile?.banned_state_safe_mode);
      const adapt = safeMode?.active ? adaptForHiddenHome : adaptForNonResident;
      subjectTpl = adapt(subjectTpl);
      bodyTpl = adapt(bodyTpl);
    }
  }

  const limits = resolveLimits(
    integration.provider,
    integration.account_email,
    (profile?.email_provider_tier as ProviderTier) ?? null,
  );

  // Re-derive every recipient from the DB. The browser supplied ids; it does
  // not get to supply addresses, and an id outside the campaign's scope is
  // dropped here rather than trusted.
  const admin = serviceClient();
  const { data: legs } = await admin
    .from("legislators")
    .select("id, state, role, locality, email, active")
    .in("id", ids)
    .eq("active", true);

  const inScope = (legs ?? []).filter((l) => legislatorInCampaignScope(l as never, campaign as never));
  const skippedOutOfScope = ids.length - inScope.length;

  // Contact-form-only officials store a URL in `email`; sending there is a
  // guaranteed bounce.
  const sendable = inScope.filter((l) => !!l.email && !l.email.startsWith("http"));
  const skippedNoEmail = inScope.length - sendable.length;

  // Never write to the same office twice for one campaign — across ANY prior
  // batch or one-off send, not just this one.
  const { data: priorActions } = await admin
    .from("campaign_actions")
    .select("legislator_id")
    .eq("user_id", user.id)
    .eq("campaign_id", campaign.id);
  const alreadySent = new Set((priorActions ?? []).map((a) => a.legislator_id));
  const fresh = sendable.filter((l) => !alreadySent.has(l.id));
  const skippedAlreadySent = sendable.length - fresh.length;

  if (fresh.length === 0) {
    return { ok: false, error: "Everyone selected has already been contacted for this campaign." };
  }

  // Refuse a letter that would go out with "{{...}}" in it. Rendered for the
  // first recipient: every recipient fills the same set of fields.
  const { data: sample } = await admin
    .from("legislators")
    .select("id, state, role, district, full_name, party, email, level, locality, body, title")
    .eq("id", fresh[0].id)
    .maybeSingle();
  const sampleVars = buildVars(profile as never, (sample ?? null) as never, sample ? [sample as never] : []);
  const unfilled = unfilledPlaceholders(`${renderTemplate(subjectTpl, sampleVars)}\n${renderTemplate(bodyTpl, sampleVars)}`);
  if (unfilled.length > 0) {
    return {
      ok: false,
      error: `Your message has ${unfilled.map((u) => `{{${u}}}`).join(", ")}, which we can't fill in. Replace it with your own words, then send.`,
    };
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count: sentToday } = await admin
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("method", "platform_email")
    .gte("sent_at", since);
  const remainingToday = Math.max(0, limits.effectiveDaily - (sentToday ?? 0));

  // Snapshot the templates. If an admin edits the campaign mid-batch,
  // recipients 1-40 and 41-198 must not receive materially different letters
  // over this user's name.
  const { data: batch, error: batchErr } = await admin
    .from("campaign_send_batches")
    .insert({
      user_id: user.id,
      campaign_id: campaign.id,
      provider: integration.provider,
      provider_tier: limits.tier,
      subject_template: subjectTpl,
      body_template: bodyTpl,
      status: "queued",
      total_count: fresh.length,
    })
    .select("id")
    .single();
  if (batchErr || !batch) return { ok: false, error: "Could not queue the send. Try again." };

  const items = fresh.map((l) => ({
    batch_id: batch.id,
    legislator_id: l.id,
    email: l.email as string,
  }));
  for (let i = 0; i < items.length; i += 200) {
    const { error } = await admin.from("campaign_send_batch_items").insert(items.slice(i, i + 200));
    if (error) {
      // Roll the batch back rather than leaving a half-populated one that the
      // worker would happily drain as if it were complete.
      await admin.from("campaign_send_batches").delete().eq("id", batch.id);
      return { ok: false, error: "Could not queue the recipients. Nothing was sent." };
    }
  }

  return {
    ok: true,
    batchId: batch.id,
    total: fresh.length,
    skippedOutOfScope,
    skippedNoEmail,
    skippedAlreadySent,
    parts: planParts(fresh.length, limits, remainingToday),
    providerLabel: limits.label,
    effectiveDaily: limits.effectiveDaily,
    remainingToday,
  };
}

export type BatchProgress = {
  id: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  pauseReason: string | null;
  providerLabel: string;
  /** Letters from the member's earlier unfinished sends, which go out first. */
  ahead: number;
} | null;

/**
 * Screen a letter while the member is still editing it, so the composer can
 * say so before they press Send (and before an external compose window
 * opens, which iKratom can't screen afterwards). The queue re-checks anyway.
 */
export async function checkLetter(subject: string, body: string): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, message: "" };
  if (!(await checkRateLimit(`letter:screen:${user.id}`, 30, 600))) return { ok: true, message: "" };
  const s = await screenMemberLetter({ subject: String(subject ?? "").slice(0, 300), body: String(body ?? "").slice(0, 12_000) });
  return { ok: !s.block, message: s.message };
}

export type SendAllowance = { used: number; limit: number; providerLabel: string } | null;

/**
 * How much of today's safe sending allowance this user has used (rolling 24h,
 * the same count the queue enforces). Shown as a bar on the send card so
 * people can see their account is never pushed to its provider's limit.
 */
export async function getSendAllowance(): Promise<SendAllowance> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const integration = await getEmailIntegration(user.id);
  if (!integration) return null;
  const { data: profile } = await supabase.from("profiles").select("email_provider_tier").eq("id", user.id).maybeSingle();
  const limits = resolveLimits(integration.provider, integration.account_email, (profile?.email_provider_tier as ProviderTier) ?? null);
  const { count } = await supabase
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("method", "platform_email")
    .gte("sent_at", new Date(Date.now() - 86_400_000).toISOString());
  return { used: count ?? 0, limit: limits.effectiveDaily, providerLabel: limits.label };
}

/** Batch statuses that still have letters to send. */
const ACTIVE = ["queued", "sending", "paused"];

/** Live progress for the user's most recent batch on a campaign. */
export async function getBatchProgress(campaignSlug: string): Promise<BatchProgress> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: campaign } = await supabase
    .from("campaigns").select("id").eq("slug", campaignSlug).maybeSingle();
  if (!campaign) return null;

  // Reads go through the USER's client, so RLS is the thing proving ownership
  // rather than a where-clause we wrote correctly.
  const { data } = await supabase
    .from("campaign_send_batches")
    .select("id, status, total_count, sent_count, failed_count, pause_reason, provider, provider_tier, created_at")
    .eq("campaign_id", campaign.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  // Letters from the member's EARLIER unfinished sends, which go out first.
  let ahead = 0;
  if (ACTIVE.includes(data.status)) {
    const { data: earlier } = await supabase
      .from("campaign_send_batches")
      .select("total_count, sent_count, failed_count")
      .eq("user_id", user.id)
      .in("status", ACTIVE)
      .lt("created_at", data.created_at);
    for (const b of earlier ?? []) ahead += Math.max(0, (b.total_count ?? 0) - (b.sent_count ?? 0) - (b.failed_count ?? 0));
  }

  const { data: profile } = await supabase
    .from("profiles").select("email_provider_tier").eq("id", user.id).maybeSingle();
  const integration = await getEmailIntegration(user.id);
  const limits = integration
    ? resolveLimits(integration.provider, integration.account_email, (profile?.email_provider_tier as ProviderTier) ?? null)
    : null;

  return {
    id: data.id,
    status: data.status,
    total: data.total_count ?? 0,
    sent: data.sent_count ?? 0,
    failed: data.failed_count ?? 0,
    pauseReason: data.pause_reason ?? null,
    providerLabel: limits?.label ?? data.provider,
    ahead,
  };
}

/**
 * Push the user's own batch forward for one short slice (~15s, under the
 * host's ~30s request budget) and report progress. The campaign page calls
 * this every few seconds while it is open, so a send finishes in minutes; if
 * the page closes, the scheduled worker finishes the rest. Ownership is
 * proven by reading the batch through the USER's client (RLS), not by a
 * where-clause.
 */
export async function continueMySend(campaignSlug: string, batchId: string): Promise<BatchProgress> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(batchId)) return null;

  const { data: mine } = await supabase
    .from("campaign_send_batches")
    .select("id, user_id, campaign_id, subject_template, body_template, status, total_count, sent_count, failed_count")
    .eq("id", batchId)
    .maybeSingle();
  if (!mine || mine.user_id !== user.id) return null;

  // One slice at a time per user; a second tab just reads progress.
  if (ACTIVE.includes(mine.status) &&
      (await checkRateLimit(`campaign:drain:${user.id}`, 1, 4))) {
    // One mailbox, one queue: sends go out in the order the member started
    // them, whichever campaign page is open. Draining only THIS page's batch
    // stalled an earlier send on another campaign until its page was reopened
    // (Paul, 10-30: 120 NJ letters sat for 45 minutes behind 138 ND ones).
    const deadline = Date.now() + 15_000;
    const { data: first } = await supabase
      .from("campaign_send_batches")
      .select("id, user_id, campaign_id, subject_template, body_template, status, total_count, sent_count, failed_count")
      .eq("user_id", user.id)
      .in("status", ACTIVE)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const head = first && first.user_id === user.id ? first : mine;
    const r = await drainBatch(serviceClient(), head, deadline);
    // Every pause reason today is mailbox-wide, but if the head ever stalls on
    // its own, it must not hold this page's send hostage.
    if (head.id !== mine.id && r.sent + r.failed === 0 && Date.now() < deadline - 2_000) {
      await drainBatch(serviceClient(), mine, deadline);
    }
  }
  return getBatchProgress(campaignSlug);
}

/** Cancel a queued/sending batch. Already-sent messages cannot be recalled. */
export async function cancelBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) return { ok: false, error: "Bad batch id." };

  const admin = serviceClient();
  // Ownership is enforced in the WHERE clause, not assumed from the id — a
  // guessed uuid must not cancel someone else's send.
  const { data, error } = await admin
    .from("campaign_send_batches")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), pause_reason: "Cancelled by you." })
    .eq("id", batchId)
    .eq("user_id", user.id)
    .in("status", ["queued", "sending", "paused"])
    .select("id");
  if (error) return { ok: false, error: "Could not cancel." };
  // Assert a row actually changed — an RLS/filter miss returns success with
  // zero rows, which would report a cancel that never happened.
  if (!data || data.length === 0) return { ok: false, error: "That batch is already finished." };

  await admin
    .from("campaign_send_batch_items")
    .update({ status: "skipped" })
    .eq("batch_id", batchId)
    .eq("status", "pending");

  return { ok: true };
}

/**
 * Persist (or clear) the user's provider-tier override.
 *
 * Validated against the tier list rather than written through: this column
 * decides how much real email we will send from someone's mailbox, so an
 * arbitrary string must never reach it. Clearing (null) returns them to
 * detection, which is the safe default.
 */
export async function setProviderTier(
  tier: ProviderTier | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in." };

  const VALID: ProviderTier[] = [
    "gmail_free", "gmail_workspace", "outlook_consumer", "outlook_business",
  ];
  if (tier !== null && !VALID.includes(tier)) {
    return { ok: false, error: "Unknown provider tier." };
  }

  // Through the USER's client so RLS proves ownership, rather than a
  // service-role write trusting a user_id we assembled ourselves.
  const { error } = await supabase
    .from("profiles")
    .update({ email_provider_tier: tier })
    .eq("id", user.id);
  if (error) return { ok: false, error: "Could not save." };
  return { ok: true };
}

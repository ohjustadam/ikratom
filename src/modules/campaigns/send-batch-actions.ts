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

/** Hard ceiling on one batch. Not a security boundary — scope is. */
const MAX_BATCH_RECIPIENTS = 1000;

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
    .select("email_provider_tier")
    .eq("id", user.id)
    .maybeSingle();

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
      subject_template: campaign.subject_template,
      body_template: campaign.body_template,
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
} | null;

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
    .select("id, status, total_count, sent_count, failed_count, pause_reason, provider, provider_tier")
    .eq("campaign_id", campaign.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

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
  };
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

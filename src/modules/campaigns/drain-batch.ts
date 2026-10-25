import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getEmailIntegration,
  sendOnUserBehalf,
  markEmailIntegrationRevoked,
  EmailTokenRevokedError,
} from "@/lib/email/user-send";
import { resolveLimits } from "@/lib/email/provider-limits";
import { buildVars, renderTemplate, unfilledPlaceholders } from "./templates";
import { withLetterFooter } from "./letter-extras";

/**
 * Deliver one slice of ONE send batch, then stop at `deadline`.
 *
 * Two callers share this (2026-10-21):
 *   - /api/cron/drain-send-batches, the safety net that finishes any batch;
 *   - continueMySend(), which the campaign page calls every few seconds while
 *     it is open, so a one-click send finishes in minutes instead of waiting
 *     for an hourly job that GitHub runs about three times a day.
 * They can overlap on the same batch, so every recipient is CLAIMED with a
 * compare-and-swap on `attempts` before anything is sent. Whoever loses the
 * swap skips that recipient; nobody gets the same letter twice.
 *
 * Every delivered letter is recorded the moment it goes out (campaign_actions,
 * with the exact text sent). The old one-click path recorded only after the
 * LAST email, so when the host cut it off at ~30s (60 of 147), none of the 60
 * were recorded and a retry would have emailed them again.
 */

/** Retries per recipient before it is marked failed and the batch moves on. */
const MAX_ATTEMPTS = 3;

export type DrainBatchRow = {
  id: string;
  user_id: string;
  campaign_id: string;
  subject_template: string;
  body_template: string;
  status: string;
  total_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
};

export type DrainResult = { sent: number; failed: number; more: boolean };

export async function drainBatch(
  supabase: SupabaseClient,
  batch: DrainBatchRow,
  deadline: number,
): Promise<DrainResult> {
  let sent = 0;
  let failed = 0;
  let more = false;

  const integration = await getEmailIntegration(batch.user_id);
  if (!integration) {
    // Disconnected mid-flight. Pause rather than fail — the queued work is
    // still valid and resumes the moment they reconnect.
    await supabase.from("campaign_send_batches")
      .update({ status: "paused", pause_reason: "Email account disconnected. Reconnect in /account to resume." })
      .eq("id", batch.id);
    return { sent, failed, more };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, username, street, city, county, state, zip, email_provider_tier")
    .eq("id", batch.user_id)
    .maybeSingle();

  const limits = resolveLimits(
    integration.provider,
    integration.account_email,
    (profile?.email_provider_tier as never) ?? null,
  );

  // How many has this user already sent TODAY, across every batch? The cap
  // belongs to their mailbox, not to any one campaign.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count: sentToday } = await supabase
    .from("campaign_actions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", batch.user_id)
    .eq("method", "platform_email")
    .gte("sent_at", since);

  let remainingToday = Math.max(0, limits.effectiveDaily - (sentToday ?? 0));
  if (remainingToday === 0) {
    // Not an error — the batch simply resumes tomorrow. Say so plainly.
    await supabase.from("campaign_send_batches")
      .update({
        status: "paused",
        pause_reason: `Daily limit reached for ${limits.label} (${limits.effectiveDaily}/day). Resumes automatically tomorrow.`,
      })
      .eq("id", batch.id);
    return { sent, failed, more };
  }

  if (batch.status === "queued" || batch.status === "paused") {
    // Reaching here means the blockers above cleared: the integration is
    // valid again and there is quota left today. Resume.
    const resuming = batch.status === "paused";
    await supabase.from("campaign_send_batches")
      .update({
        status: "sending",
        pause_reason: null,
        ...(batch.status === "queued" ? { started_at: new Date().toISOString() } : {}),
      })
      .eq("id", batch.id);

    if (resuming) {
      // Owner call 2026-08-22: tell the user when a stalled batch picks
      // back up. They authorised this mail and deserve to know it moved.
      const remainingNow = (batch.total_count ?? 0) - (batch.sent_count ?? 0) - (batch.failed_count ?? 0);
      await supabase.from("notifications").insert({
        user_id: batch.user_id,
        kind: "campaign_send_batch",
        title: "Your campaign emails resumed",
        body: `Your daily send limit reset, so the remaining ${Math.max(0, remainingNow)} message(s) are going out now.`,
        link: `/campaigns`,
      }).then(() => {}, () => {}); // never let telemetry break the send
    }
  }

  const minIntervalMs = Math.ceil(60_000 / Math.max(1, limits.maxPerMinute));

  const { data: items } = await supabase
    .from("campaign_send_batch_items")
    .select("id, legislator_id, email, attempts")
    .eq("batch_id", batch.id)
    .eq("status", "pending")
    .order("id")
    .limit(Math.min(remainingToday, 200));

  for (const item of items ?? []) {
    if (Date.now() > deadline) { more = true; break; }
    if (remainingToday <= 0) { more = true; break; }

    // Claim it. Only one drainer can move attempts from N to N+1.
    const attempts = item.attempts + 1;
    const { data: claimed } = await supabase
      .from("campaign_send_batch_items")
      .update({ attempts })
      .eq("id", item.id)
      .eq("status", "pending")
      .eq("attempts", item.attempts)
      .select("id");
    if (!claimed || claimed.length === 0) continue;

    // Re-read the legislator for personalisation, but send to the address
    // SNAPSHOTTED at enqueue — an edited legislator record must not
    // redirect mail the user already authorised.
    const { data: leg } = await supabase
      .from("legislators")
      .select("id, state, role, district, full_name, party, email, level, locality, body, title")
      .eq("id", item.legislator_id)
      .maybeSingle();

    try {
      const vars = buildVars(profile as never, (leg ?? null) as never, leg ? [leg as never] : []);
      const subject = renderTemplate(batch.subject_template, vars);
      // "Sent via iKratom — https://www.ikratom.org" closes every letter, after
      // the sender's name (the HTML part gets the logo; lib/email/letter-footer.ts).
      const body = withLetterFooter(renderTemplate(batch.body_template, vars));
      const unfilled = unfilledPlaceholders(`${subject}\n${body}`);
      if (unfilled.length > 0) {
        // Never send a letter with "{{...}}" in it. Fail this recipient
        // permanently; retrying cannot fill a placeholder we don't know.
        await supabase.from("campaign_send_batch_items")
          .update({ status: "failed", error: `Letter has unfilled {{${unfilled.join("}}, {{")}}}` })
          .eq("id", item.id);
        failed++;
        continue;
      }

      await sendOnUserBehalf({
        integration,
        fromName: profile?.full_name ?? null,
        to: item.email,
        subject,
        body,
      });

      await supabase.from("campaign_send_batch_items")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", item.id);

      // The permanent record of impact, the exact letter that went out, and
      // the source of truth for the daily cap read above.
      await supabase.from("campaign_actions").insert({
        user_id: batch.user_id,
        campaign_id: batch.campaign_id,
        legislator_id: item.legislator_id,
        method: "platform_email",
        subject: subject.slice(0, 200),
        body: body.slice(0, 5000),
        is_non_resident: !!profile?.state && !!leg?.state && profile.state !== leg.state,
      });

      sent++;
      remainingToday--;
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 400);

      if (e instanceof EmailTokenRevokedError) {
        // Every remaining send fails identically — stop, mark the
        // integration, and tell the user exactly what to do.
        await markEmailIntegrationRevoked(batch.user_id, e.provider);
        await supabase.from("campaign_send_batch_items")
          .update({ error: msg }).eq("id", item.id);
        await supabase.from("campaign_send_batches")
          .update({ status: "paused", pause_reason: "Your email connection was revoked. Reconnect in /account and this batch resumes where it stopped." })
          .eq("id", batch.id);
        break;
      }

      await supabase.from("campaign_send_batch_items")
        .update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", error: msg })
        .eq("id", item.id);
      if (attempts >= MAX_ATTEMPTS) failed++;
    }

    // Pace to the provider's ceiling, not ours.
    if (minIntervalMs > 0 && Date.now() + minIntervalMs < deadline) {
      await new Promise((r) => setTimeout(r, minIntervalMs));
    }
  }

  // Recount from the item table rather than incrementing a counter — the
  // items are the truth, and a crashed run must not leave the summary lying.
  const [{ count: doneCount }, { count: failCount }, { count: pendCount }] = await Promise.all([
    supabase.from("campaign_send_batch_items").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("status", "sent"),
    supabase.from("campaign_send_batch_items").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("status", "failed"),
    supabase.from("campaign_send_batch_items").select("id", { count: "exact", head: true }).eq("batch_id", batch.id).eq("status", "pending"),
  ]);

  const justFinished = (pendCount ?? 0) === 0;
  // Only the drainer that flips the batch to complete sends the notice.
  const { data: flipped } = await supabase.from("campaign_send_batches").update({
    sent_count: doneCount ?? 0,
    failed_count: failCount ?? 0,
    last_progress_at: new Date().toISOString(),
    ...(justFinished
      ? { status: "complete", finished_at: new Date().toISOString(), pause_reason: null }
      : {}),
  }).eq("id", batch.id).neq("status", "complete").select("id");

  if (justFinished && flipped && flipped.length > 0) {
    // Bookend the resume notice. The user started something that outlived
    // their browser tab; closing the loop is the whole point of the queue.
    const failNote = (failCount ?? 0) > 0 ? ` ${failCount} could not be delivered.` : "";
    await supabase.from("notifications").insert({
      user_id: batch.user_id,
      kind: "campaign_send_batch",
      title: "Your campaign emails are sent",
      body: `${doneCount ?? 0} message(s) delivered from your account.${failNote}`,
      link: `/campaigns`,
    }).then(() => {}, () => {});
  } else if (!justFinished) {
    more = true;
  }

  return { sent, failed, more };
}

import { NextRequest, NextResponse } from "next/server";

/**
 * drain-send-batches — the worker behind the durable send queue.
 *
 * Owner directive 2026-08-22: "closing the tab should never kill the action,
 * once it's started it should finish even if the user closes the window."
 * The enqueue action writes intent; this drains it.
 *
 * ── WHY A BOUNDED SLICE, NOT A LOOP TO COMPLETION ─────────────────────────
 * Netlify's serverless budget is ~30s. /api/cron/daily-sync was orphaned from
 * the schedule for exactly this reason — it could not finish inside the budget
 * and returned 502. So this drains for a hard TIME_BUDGET_MS and returns
 * `more: true` if work remains. The caller loops. Every unit of work is
 * committed before the budget expires, so being cut off mid-batch costs at
 * most the message in flight, and the next call resumes from the item table
 * rather than from the beginning.
 *
 * ── WHY PACING MATTERS MORE THAN SPEED ────────────────────────────────────
 * These messages leave the USER'S OWN mailbox. Exchange Online throttles a
 * mailbox above 30 messages/minute; Gmail's API quota works out near 150/min.
 * Tripping either does not merely fail a send — it can get a real person's
 * personal account rate-limited or flagged. We pace to the provider's number
 * and stop well under the daily ceiling (see provider-limits.ts). Their
 * account standing is not ours to spend.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Leaves headroom under the platform budget to flush telemetry and respond. */
const TIME_BUDGET_MS = 20_000;
/** Retries per recipient before it is marked failed and the batch moves on. */
const MAX_ATTEMPTS = 3;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  // Fail closed: an unset secret must not make `Bearer undefined` valid.
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const deadline = startedAt + TIME_BUDGET_MS;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { getEmailIntegration, sendOnUserBehalf, markEmailIntegrationRevoked, EmailTokenRevokedError } =
    await import("@/lib/email/user-send");
  const { resolveLimits } = await import("@/lib/email/provider-limits");
  const { buildVars, renderTemplate } = await import("@/modules/campaigns/templates");

  let sent = 0;
  let failed = 0;
  let batchesTouched = 0;
  let more = false;

  try {
    const { data: batches } = await supabase
      .from("campaign_send_batches")
      .select("id, user_id, campaign_id, provider, provider_tier, subject_template, body_template, status, total_count, sent_count, failed_count")
      // 'paused' MUST be included. A batch paused for "daily limit reached"
      // promises it "resumes automatically tomorrow" — if the worker never
      // picked paused rows back up, that promise would be a lie and the batch
      // would sit forever. Pause is a stall, not a terminal state; the checks
      // below re-evaluate whether the reason still holds.
      .in("status", ["queued", "sending", "paused"])
      .order("created_at", { ascending: true })
      .limit(10);

    for (const batch of batches ?? []) {
      if (Date.now() > deadline) { more = true; break; }
      batchesTouched++;

      const integration = await getEmailIntegration(batch.user_id);
      if (!integration) {
        // Disconnected mid-flight. Pause rather than fail — the queued work is
        // still valid and resumes the moment they reconnect.
        await supabase.from("campaign_send_batches")
          .update({ status: "paused", pause_reason: "Email account disconnected. Reconnect in /account to resume." })
          .eq("id", batch.id);
        continue;
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
        continue;
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
          // back up. A batch that silently resumes at 3am and finishes without
          // them knowing is the same invisibility problem as a cron that dies
          // quietly — they authorised this mail and deserve to know it moved.
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
        .limit(Math.min(remainingToday, 200));

      if (!items || items.length === 0) {
        const { count: leftover } = await supabase
          .from("campaign_send_batch_items")
          .select("id", { count: "exact", head: true })
          .eq("batch_id", batch.id)
          .eq("status", "pending");
        if ((leftover ?? 0) === 0) {
          await supabase.from("campaign_send_batches")
            .update({ status: "complete", finished_at: new Date().toISOString(), pause_reason: null })
            .eq("id", batch.id);
        }
        continue;
      }

      for (const item of items) {
        if (Date.now() > deadline) { more = true; break; }
        if (remainingToday <= 0) { more = true; break; }

        // Re-read the legislator for personalisation, but send to the address
        // SNAPSHOTTED at enqueue — an edited legislator record must not
        // redirect mail the user already authorised.
        const { data: leg } = await supabase
          .from("legislators")
          .select("id, state, role, district, full_name, party, email, level, locality, body, title")
          .eq("id", item.legislator_id)
          .maybeSingle();

        try {
          const vars = buildVars(profile as never, (leg ?? null) as never, []);
          const subject = renderTemplate(batch.subject_template, vars);
          const body = renderTemplate(batch.body_template, vars);

          await sendOnUserBehalf({
            integration,
            fromName: profile?.full_name ?? null,
            to: item.email,
            subject,
            body,
          });

          await supabase.from("campaign_send_batch_items")
            .update({ status: "sent", sent_at: new Date().toISOString(), attempts: item.attempts + 1, error: null })
            .eq("id", item.id);

          // The permanent record of impact, and the source of truth for the
          // daily cap read above.
          await supabase.from("campaign_actions").insert({
            user_id: batch.user_id,
            campaign_id: batch.campaign_id,
            legislator_id: item.legislator_id,
            method: "platform_email",
            subject: subject.slice(0, 200),
            body: body.slice(0, 5000),
          });

          sent++;
          remainingToday--;
        } catch (e) {
          const attempts = item.attempts + 1;
          const msg = String((e as Error).message ?? e).slice(0, 400);

          if (e instanceof EmailTokenRevokedError) {
            // Every remaining send fails identically — stop, mark the
            // integration, and tell the user exactly what to do.
            await markEmailIntegrationRevoked(batch.user_id, e.provider);
            await supabase.from("campaign_send_batch_items")
              .update({ attempts, error: msg }).eq("id", item.id);
            await supabase.from("campaign_send_batches")
              .update({ status: "paused", pause_reason: "Your email connection was revoked. Reconnect in /account and this batch resumes where it stopped." })
              .eq("id", batch.id);
            break;
          }

          await supabase.from("campaign_send_batch_items")
            .update({ status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, error: msg })
            .eq("id", item.id);
          if (attempts >= MAX_ATTEMPTS) failed++;
        }

        // Pace to the provider's ceiling, not ours.
        const wait = minIntervalMs - 0;
        if (wait > 0 && Date.now() + wait < deadline) {
          await new Promise((r) => setTimeout(r, wait));
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
      await supabase.from("campaign_send_batches").update({
        sent_count: doneCount ?? 0,
        failed_count: failCount ?? 0,
        last_progress_at: new Date().toISOString(),
        ...(justFinished
          ? { status: "complete", finished_at: new Date().toISOString(), pause_reason: null }
          : {}),
      }).eq("id", batch.id);

      if (justFinished) {
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
      } else {
        more = true;
      }
    }
  } catch (e) {
    await supabase.from("scraper_runs").insert({
      source: "drain_send_batches",
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      status: "error",
      notes: String((e as Error).message ?? e).slice(0, 300),
    }).then(() => {}, () => {});
    return NextResponse.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }

  // Telemetry every run, including the quiet ones — a source that only reports
  // when it has work is indistinguishable from a dead one (see d29368f).
  await supabase.from("scraper_runs").insert({
    source: "drain_send_batches",
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date().toISOString(),
    status: sent === 0 && failed === 0 ? "empty" : "success",
    rows_updated: sent,
    notes: `sent ${sent} · failed ${failed} · batches ${batchesTouched} · ${Math.round((Date.now() - startedAt) / 1000)}s`,
  }).then(() => {}, () => {});

  return NextResponse.json({
    ok: true,
    sent,
    failed,
    batches: batchesTouched,
    more,
    elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

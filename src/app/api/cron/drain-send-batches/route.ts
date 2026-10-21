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

  const { drainBatch } = await import("@/modules/campaigns/drain-batch");

  let sent = 0;
  let failed = 0;
  let batchesTouched = 0;
  let more = false;

  try {
    const { data: batches } = await supabase
      .from("campaign_send_batches")
      .select("id, user_id, campaign_id, subject_template, body_template, status, total_count, sent_count, failed_count")
      // 'paused' MUST be included. A batch paused for "daily limit reached"
      // promises it "resumes automatically tomorrow" — if the worker never
      // picked paused rows back up, that promise would be a lie and the batch
      // would sit forever. Pause is a stall, not a terminal state; drainBatch
      // re-evaluates whether the reason still holds.
      .in("status", ["queued", "sending", "paused"])
      .order("created_at", { ascending: true })
      .limit(10);

    // The per-batch work lives in src/modules/campaigns/drain-batch.ts, shared
    // with continueMySend() so an open campaign page can drive its own send.
    for (const batch of batches ?? []) {
      if (Date.now() > deadline) { more = true; break; }
      batchesTouched++;
      const r = await drainBatch(supabase, batch, deadline);
      sent += r.sent;
      failed += r.failed;
      if (r.more) more = true;
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

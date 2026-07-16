import { NextRequest, NextResponse } from "next/server";

/**
 * Wave-firing cron — runs hourly via Vercel.
 *
 * Picks up any active, unfired campaign_waves where scheduled_at <= now,
 * sends the personalized email for every joined user via their connected
 * Gmail account, and marks the wave fired with sent/failed counts.
 *
 * Hourly granularity is the trade-off for free-tier cron. UI tells users
 * "your email goes out within 1 hour of <scheduled_at>".
 *
 * Idempotency: each signup row's send_status filters to 'pending', so a
 * second run of the same wave can only re-attempt the failures (and we
 * mark them as failed instead of pending after the first run, so they
 * won't re-try unless explicitly reset).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const startedAt = Date.now();

  // 1. Fire waves whose scheduled_at <= now
  const { fireDueWaves } = await import("@/modules/waves/fire");
  const fireResult = await fireDueWaves(supabase);

  // 2. Send 1-hour-prior reminder emails (no-ops cleanly without Resend)
  const { sendWaveReminders } = await import("@/modules/waves/reminders");
  const reminderResult = await sendWaveReminders(supabase);

  // 3. Web Push fan-out — deliver any notifications inserted in the last
  // hour to subscribers' devices. No-ops cleanly when VAPID isn't set.
  const { fanoutPushNotifications } = await import("@/modules/notifications/push-fanout");
  const pushResult = await fanoutPushNotifications(supabase);

  const elapsedMs = Date.now() - startedAt;

  // Telemetry so check-cron-staleness can monitor this route. It is the SOLE
  // push/email delivery path (fanoutPushNotifications) and daily-sync defers
  // ALL its push to this hourly tick — yet it wrote no scraper_runs row, so a
  // silent stall (CRON_SECRET rotation / 500 / GH billing) would strand every
  // notification with no owner page. `fire_waves` is already in the UI catalog
  // (cron-registry.ts) and now in the pager registry too. Best-effort insert.
  try {
    const pushSent = (pushResult && "sent" in pushResult ? pushResult.sent : 0) ?? 0;
    const pushHeld = (pushResult && "held" in pushResult ? pushResult.held : 0) ?? 0;
    await supabase.from("scraper_runs").insert({
      source: "fire_waves",
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      status: "success",
      rows_updated: pushSent,
      notes: `push sent ${pushSent} · held ${pushHeld} · ${Math.round(elapsedMs / 1000)}s`,
    });
  } catch { /* best-effort telemetry */ }

  return NextResponse.json({
    ok: true,
    elapsed_seconds: Math.round(elapsedMs / 1000),
    fire: fireResult,
    reminders: reminderResult,
    push: pushResult,
  });
}

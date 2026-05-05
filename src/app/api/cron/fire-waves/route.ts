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
  const { fireDueWaves } = await import("@/modules/waves/fire");
  const result = await fireDueWaves(supabase);
  const elapsedMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: true,
    elapsed_seconds: Math.round(elapsedMs / 1000),
    ...result,
  });
}

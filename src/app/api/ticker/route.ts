import { NextResponse } from "next/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { buildTicker, TICKER_LIMITS } from "@/lib/ticker";

/**
 * GET /api/ticker — the intel ticker's items (src/lib/ticker.ts).
 *
 * Static + ISR, 10 minutes: one tiny regeneration per 10 minutes however many
 * visitors load it, so it costs next to nothing in Supabase egress or Netlify
 * compute. Cookie-less (anon client): every row is public, approved content.
 * IntelTicker fetches it in the browser, so even fully static pages show
 * fresh news without being rebuilt.
 */
export const dynamic = "force-static";
export const revalidate = 600;

export async function GET() {
  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const sb = createAnonClient();
  const [campaigns, alerts, meetings] = await Promise.all([
    sb.from("campaigns").select("slug, title, state, created_at")
      .eq("active", true).gte("created_at", ago(TICKER_LIMITS.campaignDays))
      .order("created_at", { ascending: false }).limit(8),
    sb.from("policy_alerts").select("id, title, locality, severity, created_at")
      .eq("moderation_status", "approved").in("severity", ["critical", "alert"])
      .gte("created_at", ago(TICKER_LIMITS.alertDays))
      .order("created_at", { ascending: false }).limit(20),
    sb.from("municipal_meetings").select("id, locality, state, body_name, meeting_at")
      .eq("moderation_status", "approved").gte("meeting_at", now.toISOString())
      .lte("meeting_at", new Date(now.getTime() + TICKER_LIMITS.meetingDays * 86_400_000).toISOString())
      .order("meeting_at", { ascending: true }).limit(6),
  ]);
  const items = buildTicker(
    { campaigns: campaigns.data ?? [], alerts: alerts.data ?? [], meetings: meetings.data ?? [] },
    now.getTime(),
  );
  return NextResponse.json({ items, generated_at: now.toISOString() });
}

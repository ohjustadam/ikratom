import { ImageResponse } from "next/og";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const alt = "iKratom — state kratom policy hub";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"D.C.",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

/**
 * Dynamic OG card for /states/[code]. Renders state badge, full name,
 * and live signal counts (bills + meetings + alerts) so the shared
 * link gives recipients a strong sense of what's happening in that
 * state without having to click through.
 *
 * Pulls signal counts via service-role since the OG route runs
 * unauthenticated. Falls back to a static tile if env not configured.
 */
export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const codeUpper = code.toUpperCase();
  const stateName = STATE_NAMES[codeUpper];

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !stateName) {
    return new ImageResponse(<FallbackTile state={codeUpper} stateName={stateName ?? "Unknown"} bills={0} meetings={0} alerts={0} />, size);
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } });
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 86_400_000).toISOString();
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const [bills, meetings, alerts] = await Promise.all([
    sb.from("bills").select("id", { count: "exact", head: true })
      .eq("state", codeUpper).eq("active", true)
      .in("kratom_relevance", ["anti", "pro"]),
    sb.from("municipal_meetings").select("id", { count: "exact", head: true })
      .eq("state", codeUpper).eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString()).lte("meeting_at", horizon),
    sb.from("policy_alerts").select("id", { count: "exact", head: true })
      .or(`locality.eq.${codeUpper},locality.ilike.%, ${codeUpper}`)
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .gte("created_at", since30d),
  ]);

  const billCount = bills.count ?? 0;
  const meetingCount = meetings.count ?? 0;
  const alertCount = alerts.count ?? 0;
  const totalSignals = billCount + meetingCount + alertCount;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #050505 0%, #0a0a0a 50%, #042f2e 100%)",
          padding: "60px 70px",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Top: state badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span
            style={{
              background: "#10b981",
              color: "#0a0a0a",
              padding: "16px 32px",
              borderRadius: 10,
              fontSize: 64,
              fontWeight: 900,
              letterSpacing: 6,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            {codeUpper}
          </span>
          <span style={{ fontSize: 26, color: "#10b981", letterSpacing: 6, textTransform: "uppercase", fontWeight: 700 }}>
            ◉ Kratom policy
          </span>
        </div>

        {/* Headline: state name */}
        <h1 style={{ marginTop: 30, fontSize: 96, fontWeight: 900, lineHeight: 1.0, color: "#fafafa" }}>
          {stateName}
        </h1>
        <p style={{ marginTop: 8, fontSize: 36, color: "#a1a1aa", lineHeight: 1.15 }}>
          {totalSignals === 0
            ? "Quiet right now — sign up to be the first to act when it isn't."
            : "Active signals · take one-click action on every one"}
        </p>

        {/* Signal counts grid */}
        {totalSignals > 0 && (
          <div style={{ marginTop: 38, display: "flex", gap: 30 }}>
            <SignalCard emoji="📜" count={billCount} label="Active bills" />
            <SignalCard emoji="📅" count={meetingCount} label="Upcoming meetings" />
            <SignalCard emoji="🚨" count={alertCount} label="Alerts (30d)" />
          </div>
        )}

        {/* Bottom: brand */}
        <div style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 30,
          borderTop: "2px solid #10b981",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 42, fontWeight: 900, color: "#10b981" }}>i</span>
            <span style={{ fontSize: 42, fontWeight: 800, color: "#fafafa" }}>Kratom</span>
            <span style={{ fontSize: 26, color: "#71717a", marginLeft: 16 }}>
              the advocate&apos;s toolbelt
            </span>
          </div>
          <div style={{ background: "#10b981", color: "#0a0a0a", padding: "14px 28px", borderRadius: 8, fontSize: 28, fontWeight: 800 }}>
            ikratom.org/states/{codeUpper}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function SignalCard({ emoji, count, label }: { emoji: string; count: number; label: string }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      background: count > 0 ? "rgba(16, 185, 129, 0.1)" : "rgba(255, 255, 255, 0.04)",
      border: `2px solid ${count > 0 ? "#10b981" : "#27272a"}`,
      borderRadius: 12,
      padding: "20px 28px",
      minWidth: 240,
    }}>
      <span style={{ fontSize: 50 }}>{emoji}</span>
      <span style={{ fontSize: 72, fontWeight: 900, color: count > 0 ? "#10b981" : "#71717a", marginTop: 4, lineHeight: 1 }}>
        {count}
      </span>
      <span style={{ fontSize: 22, color: "#a1a1aa", marginTop: 4 }}>{label}</span>
    </div>
  );
}

function FallbackTile({ state, stateName, bills, meetings, alerts }: {
  state: string; stateName: string; bills: number; meetings: number; alerts: number;
}) {
  // Static fallback when env vars missing.
  return (
    <div style={{
      width: "100%",
      height: "100%",
      background: "#0a0a0a",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: "system-ui, sans-serif",
    }}>
      <p style={{ fontSize: 32, color: "#10b981", letterSpacing: 4, textTransform: "uppercase" }}>iKratom</p>
      <p style={{ fontSize: 88, fontWeight: 900, color: "#fafafa", marginTop: 12 }}>{stateName} · {state}</p>
      <p style={{ fontSize: 32, color: "#a1a1aa", marginTop: 12 }}>
        {bills + meetings + alerts > 0 ? "Active signals" : "Kratom policy hub"}
      </p>
    </div>
  );
}

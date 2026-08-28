import { ImageResponse } from "next/og";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const alt = "iKratom policy alert";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const KIND_LABEL: Record<string, string> = {
  bill_event: "LEGISLATION",
  bop_hearing: "BoP HEARING",
  ag_enforcement: "AG ACTION",
  ag_action: "AG ACTION",
  fda_action: "FDA ACTION",
  dea_action: "DEA ACTION",
  court_ruling: "COURT RULING",
  news_break: "BREAKING NEWS",
  intel_tip: "INTEL TIP",
  city_event: "MUNICIPAL EVENT",
  city_ordinance: "MUNICIPAL ORDINANCE",
};

/**
 * Per-alert OG card. When a user shares /alerts/[id] on Messenger /
 * iMessage / Slack / Discord / Twitter, recipients see this 1200×630
 * preview: severity, kind, locality, title, body excerpt.
 *
 * Designed to convey URGENCY visually — critical alerts get a red
 * banner, alert-tier gets amber. Locality + kind badges in the
 * header bar.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new ImageResponse(<Fallback />, size);
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } });
  const { data: a } = await sb
    .from("policy_alerts")
    .select("kind, severity, title, body, locality, created_at, occurs_at")
    .eq("id", id)
    .maybeSingle();

  if (!a) return new ImageResponse(<Fallback />, size);

  const isCritical = a.severity === "critical";
  const isAlert = a.severity === "alert";
  const severityBg = isCritical ? "#7f1d1d" : isAlert ? "#78350f" : "#1e3a3a";
  const severityFg = isCritical ? "#fee2e2" : isAlert ? "#fef3c7" : "#a7f3d0";
  const severityLabel = isCritical ? "🚨 CRITICAL" : isAlert ? "⚠️ ALERT" : "👁️ WATCH";
  const sevEmojiAccent = isCritical ? "#dc2626" : isAlert ? "#f59e0b" : "#10b981";

  const kindLabel = KIND_LABEL[a.kind] ?? a.kind?.toUpperCase().replace(/_/g, " ");
  const bodyFirstLine = (a.body ?? "").split(/\n+/).find((p: string) => p.trim().length > 0)?.replace(/^\*\*[^*]+\*\*:?\s*/, "")?.slice(0, 220) ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(135deg, #050505 0%, #0a0a0a 50%, ${severityBg} 100%)`,
          padding: "60px 70px",
          color: "#fafafa",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Severity row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span
            style={{
              background: sevEmojiAccent,
              color: "#fafafa",
              padding: "12px 26px",
              borderRadius: 8,
              fontSize: 30,
              fontWeight: 900,
              letterSpacing: 3,
            }}
          >
            {severityLabel}
          </span>
          {kindLabel && (
            <span
              style={{
                background: "#18181b",
                color: "#a1a1aa",
                padding: "10px 22px",
                borderRadius: 6,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 3,
                border: "1px solid #27272a",
              }}
            >
              {kindLabel}
            </span>
          )}
          {a.locality && (
            <span
              style={{
                background: "#18181b",
                color: severityFg,
                padding: "10px 22px",
                borderRadius: 6,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 2,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                border: "1px solid #27272a",
              }}
            >
              📍 {a.locality}
            </span>
          )}
        </div>

        {/* Title */}
        <h1
          style={{
            marginTop: 40,
            fontSize: 64,
            fontWeight: 900,
            lineHeight: 1.05,
            color: "#fafafa",
            maxWidth: 1060,
          }}
        >
          {a.title.slice(0, 180)}
        </h1>

        {/* Body excerpt */}
        {bodyFirstLine && (
          <p
            style={{
              marginTop: 28,
              fontSize: 28,
              color: "#d4d4d8",
              lineHeight: 1.35,
              fontStyle: "italic",
              maxWidth: 1060,
            }}
          >
            &quot;{bodyFirstLine}&quot;
          </p>
        )}

        {/* Brand bar */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 30,
            borderTop: `2px solid ${sevEmojiAccent}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 42, fontWeight: 900, color: "#10b981" }}>i</span>
            <span style={{ fontSize: 42, fontWeight: 800, color: "#fafafa" }}>Kratom</span>
            <span style={{ fontSize: 24, color: "#71717a", marginLeft: 16 }}>
              policy alert
            </span>
          </div>
          <div
            style={{
              background: "#10b981",
              color: "#0a0a0a",
              padding: "14px 28px",
              borderRadius: 8,
              fontSize: 26,
              fontWeight: 800,
            }}
          >
            Read · share · act
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function Fallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a0a",
        color: "#dc2626",
        fontSize: 96,
        fontWeight: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      🚨 iKratom
    </div>
  );
}

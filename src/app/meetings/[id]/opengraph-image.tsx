import { ImageResponse } from "next/og";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const alt = "iKratom live meeting";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Per-meeting Open Graph image, dynamically generated at request time.
 *
 * Facebook Messenger, iMessage, Twitter, Slack, Discord all render
 * this when the meeting URL is shared. Designed to be eye-catching:
 *   - Large red "LIVE NOW" tag if the meeting is in progress
 *   - Locality + body name as the headline
 *   - Date/time + state badge
 *   - iKratom branding bottom-right
 *
 * Uses next/og's ImageResponse (JSX → PNG). Service-role read on
 * municipal_meetings since the og-image route runs unauthenticated.
 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  // Next 16: params is a Promise. Awaiting it fixes the fallback-tile rendering.
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return new ImageResponse(<FallbackTile title="iKratom" />, size);
  }
  const sb = createServiceClient(url, key, { auth: { persistSession: false } });
  const { data: m } = await sb
    .from("municipal_meetings")
    .select("state, locality, body_name, meeting_at, agenda_text, livestream_url, zoom_url")
    .eq("id", id)
    .maybeSingle();

  if (!m) {
    return new ImageResponse(<FallbackTile title="Meeting" />, size);
  }

  const when = new Date(m.meeting_at);
  const sinceMs = Date.now() - when.getTime();
  const isLive = sinceMs >= 0 && sinceMs < 6 * 60 * 60 * 1000;
  const dateStr = when.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const agendaSnippet = (m.agenda_text ?? "").slice(0, 180);

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
        {/* Top bar: state badge + live tag */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              background: "#18181b",
              color: "#a1a1aa",
              padding: "8px 18px",
              borderRadius: 6,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: 4,
              border: "1px solid #27272a",
            }}
          >
            {m.state}
          </span>
          {isLive ? (
            <span
              style={{
                background: "#dc2626",
                color: "#ffffff",
                padding: "8px 22px",
                borderRadius: 6,
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: 2,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              🔴 LIVE NOW
            </span>
          ) : (
            <span
              style={{
                background: "#0f766e",
                color: "#fafafa",
                padding: "8px 22px",
                borderRadius: 6,
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              📅 KRATOM ON AGENDA
            </span>
          )}
        </div>

        {/* Eyebrow */}
        <p
          style={{
            marginTop: 38,
            fontSize: 26,
            color: "#10b981",
            letterSpacing: 6,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          ◉ Public meeting · Kratom policy
        </p>

        {/* Main headline */}
        <h1
          style={{
            marginTop: 12,
            fontSize: 78,
            fontWeight: 900,
            lineHeight: 1.05,
            color: "#fafafa",
            maxWidth: 1000,
          }}
        >
          {m.locality ?? m.state}
        </h1>
        {m.body_name && (
          <h2
            style={{
              marginTop: 8,
              fontSize: 44,
              fontWeight: 600,
              color: "#a1a1aa",
              lineHeight: 1.1,
            }}
          >
            {m.body_name}
          </h2>
        )}

        {/* Date / agenda snippet */}
        <p
          style={{
            marginTop: 30,
            fontSize: 30,
            color: "#d4d4d8",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
          }}
        >
          {dateStr}
        </p>

        {agendaSnippet && (
          <p
            style={{
              marginTop: 18,
              fontSize: 26,
              color: "#e4e4e7",
              lineHeight: 1.35,
              fontStyle: "italic",
              maxWidth: 1000,
            }}
          >
            "{agendaSnippet}{(m.agenda_text ?? "").length > 180 ? "…" : ""}"
          </p>
        )}

        {/* Bottom bar: brand + CTA */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 30,
            borderTop: "2px solid #10b981",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 38, fontWeight: 900, color: "#10b981" }}>i</span>
            <span style={{ fontSize: 38, fontWeight: 800, color: "#fafafa" }}>Kratom</span>
            <span style={{ fontSize: 24, color: "#71717a", marginLeft: 16 }}>
              the advocate's toolbelt
            </span>
          </div>
          <div
            style={{
              background: "#10b981",
              color: "#0a0a0a",
              padding: "14px 28px",
              borderRadius: 8,
              fontSize: 28,
              fontWeight: 800,
            }}
          >
            Watch · call · show up
          </div>
        </div>
      </div>
    ),
    size,
  );
}

function FallbackTile({ title }: { title: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a0a",
        color: "#10b981",
        fontSize: 96,
        fontWeight: 900,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {title}
    </div>
  );
}

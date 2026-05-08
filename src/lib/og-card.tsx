/**
 * Shared visual layout for Open Graph + Twitter card images.
 *
 * Used by:
 *   - src/app/opengraph-image.tsx           (default home banner)
 *   - src/app/twitter-image.tsx             (same)
 *   - src/app/pulse/opengraph-image.tsx     (Pulse surface)
 *   - src/app/briefings/[slug]/opengraph-image.tsx (per-briefing)
 *   - src/app/bills/[id]/opengraph-image.tsx (per-bill)
 *
 * Constraints (Next/Vercel @vercel/og ImageResponse):
 *   - Subset of CSS: flexbox only, no grid, no calc()
 *   - Every element with multiple children needs display: flex
 *   - System fonts only unless we ship our own (we don't, system suffices)
 *
 * Visual identity:
 *   - 1200×630 (the standard Twitter/Facebook large card)
 *   - Dark background matching site theme (#0a0a0a)
 *   - Emerald accent stripe on the left edge
 *   - iKratom wordmark in the bottom-right corner
 *   - Optional category pill (POLICY BRIEFING, STATE BILL · NH, etc.)
 *   - Big title up to ~3 lines
 *   - Optional subtitle
 */

import type { ReactElement } from "react";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export function OgCard({
  pill,
  pillColor = "#10b981",
  title,
  subtitle,
  footer = "ikratom.org · the advocate's toolbelt",
}: {
  pill?: string;
  pillColor?: string;
  title: string;
  subtitle?: string | null;
  footer?: string;
}): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a0a",
        display: "flex",
        position: "relative",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Emerald accent stripe down the left edge */}
      <div
        style={{
          width: 14,
          background: "#10b981",
          display: "flex",
        }}
      />

      {/* Main content column */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "64px 80px",
          justifyContent: "space-between",
        }}
      >
        {/* Top: optional category pill */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {pill ? (
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                background: pillColor,
                color: "#0a0a0a",
                padding: "8px 18px",
                borderRadius: 6,
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 28,
              }}
            >
              {pill}
            </div>
          ) : (
            <div style={{ marginBottom: 28, display: "flex" }} />
          )}

          {/* Title */}
          <div
            style={{
              fontSize: title.length > 80 ? 56 : title.length > 50 ? 64 : 76,
              fontWeight: 800,
              color: "#fafafa",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              maxWidth: 1000,
              display: "flex",
            }}
          >
            {title}
          </div>

          {subtitle ? (
            <div
              style={{
                marginTop: 24,
                fontSize: 28,
                color: "#a1a1aa",
                lineHeight: 1.3,
                maxWidth: 980,
                display: "flex",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        {/* Bottom row: wordmark + tagline */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: "2px solid #18181b",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 32,
              fontWeight: 700,
              color: "#fafafa",
            }}
          >
            <span style={{ color: "#10b981", marginRight: 4 }}>i</span>
            <span>Kratom</span>
          </div>
          <div style={{ fontSize: 20, color: "#71717a", display: "flex" }}>
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}

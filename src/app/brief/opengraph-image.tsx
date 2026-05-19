import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "iKratom Daily Brief — alerts, watched bills, active operations";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * OG image for /brief — the daily-digest landing page. Shareable
 * when advocates pass the brief link to teammates or post it on
 * coalition channels.
 */
export default function Image() {
  return new ImageResponse(
    OgCard({
      pill: "☕ Daily brief",
      pillColor: "#10b981",
      title: "Today's intel, in two sentences.",
      subtitle:
        "AI-synthesized state alerts + watched-bill movements + active operations. Push delivery available. Always free.",
    }),
    OG_SIZE,
  );
}

import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "Support iKratom — keep the advocate's toolbelt free + independent";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * OG image for the /support donation page. When this URL is shared
 * on Twitter, Discord, or Facebook, this card appears in the
 * preview. Designed to communicate the funding ask at a glance —
 * the title is the value prop, the subtitle is the integrity claim.
 *
 * Generated server-side via @vercel/og. Free to render.
 */
export default function Image() {
  return new ImageResponse(
    OgCard({
      pill: "♥ Support",
      pillColor: "#10b981",
      title: "Keep the advocate's toolbelt free + independent.",
      subtitle:
        "Pay-what-you-want. No paywalls. No industry money. Ever. Quarterly transparency report. The integrity moat is the platform.",
    }),
    OG_SIZE,
  );
}

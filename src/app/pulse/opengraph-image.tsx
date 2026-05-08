import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "iKratom Pulse — live kratom policy feed";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        pill="Live policy feed"
        title="Pulse — every kratom-policy event, sorted by urgency"
        subtitle="Federal, state, board of pharmacy, news and advocate intel. Take action in one click."
      />
    ),
    { ...size },
  );
}

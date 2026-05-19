import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "iKratom — do this now. One screen, one action.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/**
 * OG image for /now — the mobile-first action panel. Designed to
 * be shared in moments of crisis ("call your reps, link below").
 */
export default function Image() {
  return new ImageResponse(
    OgCard({
      pill: "👉 Do this now",
      pillColor: "#f59e0b",
      title: "One screen. One action. Two minutes.",
      subtitle:
        "Highest-leverage thing you can do for kratom advocacy in the next two minutes. Phone-first.",
    }),
    OG_SIZE,
  );
}

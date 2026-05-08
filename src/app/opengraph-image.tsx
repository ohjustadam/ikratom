import { ImageResponse } from "next/og";
import { OgCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og-card";

export const alt = "iKratom — the advocate's toolbelt for kratom policy";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        pill="The advocate's toolbelt"
        title="Track every kratom bill. Email your reps in one click. Win the policy fight."
        subtitle="Federal · state · board of pharmacy · city council. Live policy intel for the kratom community."
      />
    ),
    { ...size },
  );
}

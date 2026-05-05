import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 100,
          background: "#0a0a0a",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          color: "#10b981",
          fontFamily: "system-ui, -apple-system, sans-serif",
          letterSpacing: "-0.05em",
        }}
      >
        iK
      </div>
    ),
    { ...size },
  );
}

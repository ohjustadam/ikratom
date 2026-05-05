import { ImageResponse } from "next/og";

// Image metadata
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

// Auto-generated app icon — used as favicon, manifest icon, etc.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 280,
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
    {
      ...size,
    },
  );
}

import QRCode from "qrcode";

/**
 * Render a QR code as an inline-safe SVG string. SVG (vs PNG) is the right
 * default for our use because:
 *   - prints crisply at any size, even on cheap inkjets
 *   - can be embedded directly in the print page HTML, no separate file
 *   - the printable kit includes 4 different physical sizes from the same
 *     SVG, so we don't have to regenerate a raster per format
 *
 * Error correction level "H" (30%) so a partially-blurry print still scans.
 */
export async function renderQrSvg(url: string, opts?: { size?: number }): Promise<string> {
  const size = opts?.size ?? 320;
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 1,
    width: size,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
}

/**
 * Build the URL we encode in a partner's QR codes. The format must match
 * what proxy.ts expects in the embed-referral capture (HOST_RE), and it
 * lands on the homepage so the user immediately sees the value prop and
 * the "join in 30 seconds" CTA.
 *
 * NOTE: the slug check stays in sync with the migration's regex constraint.
 */
export function partnerQrUrl(opts: { origin: string; slug: string }): string {
  // Trailing slash on origin is fine; URL ctor normalizes.
  const u = new URL(opts.origin);
  u.searchParams.set("ref", "embed");
  u.searchParams.set("host", opts.slug);
  return u.toString();
}

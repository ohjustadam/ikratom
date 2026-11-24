import { brandIconResponse } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** The iOS home-screen icon: the "ik" mark. iOS rounds the corners itself. */
export default function AppleIcon() {
  return brandIconResponse(size.width);
}

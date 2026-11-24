import { brandIconResponse } from "@/lib/brand-icon";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** The app icon (manifest, push notifications, PNG favicon): the "ik" mark. docs/BRAND.md. */
export default function Icon() {
  return brandIconResponse(size.width);
}

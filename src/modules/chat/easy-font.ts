import { Atkinson_Hyperlegible } from "next/font/google";

/**
 * Atkinson Hyperlegible, the Braille Institute's free font designed so similar
 * letters (I l 1, O 0, b d) can't be confused. The Lounge's "easy-read
 * letters" option (B8). Self-hosted by next/font, and preload is off, so the
 * files download only for a member who turns it on.
 */
export const easyReadFont = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

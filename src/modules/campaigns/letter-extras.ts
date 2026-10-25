/**
 * The lines iKratom adds to a member's letter, in one place so every send path
 * renders them the same way (B3, 2026-10-24).
 *
 *   - The CLIP LINE is the member's own: the recorder appends it to the letter
 *     they are editing, so they see it, can delete it, and it rides along in
 *     every path (one-click Gmail/Outlook/SMTP, waves, mailto, web compose).
 *   - The FOOTER (src/lib/email/letter-footer.ts) is added at SEND time, after
 *     the letter is rendered for each official, never stored in a template.
 *     Migration 0272's trigger strips Source/Background lines from templates,
 *     and screening (#1015) and the unfilled-placeholder guard run on the
 *     member's text, so the footer can never trip either. Owner ask: "so the
 *     receiver knows what service the email came from". sendOnUserBehalf adds
 *     it again (idempotently) with the HTML logo version, so no path can skip it.
 */

export { LETTER_FOOTER, withLetterFooter } from "@/lib/email/letter-footer";

export type LetterClip = { kind: "audio" | "video"; url: string; durationSeconds: number };

const CLIP_LINE = /^(?:Listen to my \d+-second message|Watch my \d+-second video message): https?:\/\/\S+$/;

/** "Listen to my 30-second message: <url>" — one plain line, no emoji. */
export function clipLine(clip: LetterClip): string {
  const secs = Math.max(1, Math.min(30, Math.round(clip.durationSeconds || 30)));
  return clip.kind === "video"
    ? `Watch my ${secs}-second video message: ${clip.url}`
    : `Listen to my ${secs}-second message: ${clip.url}`;
}

/** Add the clip line to the end of the letter, replacing an earlier clip so a re-record never stacks two. */
export function appendClipLine(body: string, clip: LetterClip): string {
  const kept = String(body ?? "")
    .split("\n")
    .filter((l) => !CLIP_LINE.test(l.trim()))
    .join("\n")
    .replace(/\s+$/, "");
  return kept ? `${kept}\n\n${clipLine(clip)}` : clipLine(clip);
}

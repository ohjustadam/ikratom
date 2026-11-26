/**
 * The "Coming next" part of a patch note's markdown.
 *
 * A note with ledger items (migration 0323) shows the scoreboard and the
 * ledger instead of its markdown body, so anything written only in the body
 * never reached the public page. On 2026-11-25 the owner asked for the Lounge
 * photo-safety promise to be visible on the note; it lived in a
 * "## 🔜 Coming next" section of the body and was invisible. Ledger notes now
 * render just that section under the ledger. Notes without a ledger still
 * render their whole body, unchanged.
 *
 * Pure (no server-only), so it can be unit-tested.
 */

const HEADING = /^##\s+.*\bcoming next\b/i;
const NEXT_HEADING = /^#{1,2}\s/;
const SIGN_OFF = /^spot something off/i;

/** The section from its "## … Coming next" heading up to the next top-level
 *  heading or the "Spot something off" sign-off, heading included; null when
 *  the note has none or it is empty. */
export function comingNextSection(md: string | null | undefined): string | null {
  if (!md) return null;
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => HEADING.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (NEXT_HEADING.test(lines[i]) || SIGN_OFF.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").trim();
  return body ? `${lines[start]}\n\n${body}` : null;
}

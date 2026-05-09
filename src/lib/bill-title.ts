/**
 * Bill title sanitization for display.
 *
 * The `bills.title` column captures whatever the source (OpenStates,
 * news scraper, AI extractor) emitted. For state-legislative bills
 * that's usually a clean caption; for AI-extracted municipal bills
 * (Marshall-IL-style and San Buenaventura-CA-style) it can be a
 * full-paragraph summary that runs 200+ chars and breaks card
 * layouts.
 *
 * displayTitle() returns a clean, length-capped version safe for
 * card UI. Original bill.title stays available via tooltip /
 * detail-page expansion.
 *
 * Rules (in order):
 *   1. Trim whitespace
 *   2. Strip leading "[...]" prefix tags (e.g. "[🚫 Restrictive] ")
 *      that the auto-post step adds to forum-thread titles but isn't
 *      wanted on the bill itself
 *   3. If the title contains an em-dash (—) or " - " separator, cut
 *      at the first one (these usually separate locality/bill-num
 *      from a long description)
 *   4. If still > 80 chars, cut at the last sentence boundary
 *      (period / question / exclamation) before char 80
 *   5. If no clean cut found, hard-cut at 80 chars + "…"
 */
export function displayTitle(raw: string | null | undefined, maxChars = 80): string {
  if (!raw) return "(untitled)";
  let t = raw.trim();
  // Strip "[anything] " prefix
  t = t.replace(/^\s*\[[^\]]+\]\s*/, "");
  // Strip a single leading em-dash variant if it's there (e.g. " — Title")
  t = t.replace(/^[—\-·]\s*/, "").trim();

  // Cut at first em-dash / spaced hyphen — this catches the dominant
  // pattern: "Marshall, IL — city ordinance bans kratom SALES (already
  // in effect)" → "Marshall, IL"
  const dashMatch = t.match(/^(.+?)\s*[—–]\s+/);
  if (dashMatch && dashMatch[1].trim().length >= 8) {
    return dashMatch[1].trim();
  }
  const hyphenMatch = t.match(/^(.+?)\s+-\s+/);
  if (hyphenMatch && hyphenMatch[1].trim().length >= 8) {
    return hyphenMatch[1].trim();
  }

  if (t.length <= maxChars) return t;

  // Try to cut at last sentence boundary before maxChars
  const slice = t.slice(0, maxChars);
  const lastPunc = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("; "),
  );
  if (lastPunc >= 30) {
    return slice.slice(0, lastPunc + 1);
  }
  // Try last word boundary
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace >= 30) {
    return slice.slice(0, lastSpace) + "…";
  }
  // Hard cut
  return slice.trim() + "…";
}

/**
 * Subtitle / supplemental — what came AFTER the cut-point in
 * displayTitle(). Useful for showing the full context as a smaller
 * second line under the main title.
 */
export function displaySubtitle(raw: string | null | undefined, maxChars = 200): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^\s*\[[^\]]+\]\s*/, "");
  const dashMatch = t.match(/^.+?\s*[—–]\s+(.+)$/);
  if (dashMatch) {
    const sub = dashMatch[1].trim();
    return sub.length > maxChars ? sub.slice(0, maxChars).trim() + "…" : sub;
  }
  const hyphenMatch = t.match(/^.+?\s+-\s+(.+)$/);
  if (hyphenMatch) {
    const sub = hyphenMatch[1].trim();
    return sub.length > maxChars ? sub.slice(0, maxChars).trim() + "…" : sub;
  }
  return null;
}

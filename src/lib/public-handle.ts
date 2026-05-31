/**
 * publicHandle — the ONLY identity string allowed in public surfaces
 * (lounge chat, forums, comments, activity feeds, public profiles, DM
 * pickers). Public anonymity is a hard product rule: never render a
 * user's real name (full_name) or email in any area other users can see.
 *
 * Resolution order:
 *   1. @username — the user's chosen public handle
 *   2. "Advocate from {ST}" — when no handle but we know their state
 *   3. "Member" — last resort
 *
 * Deliberately does NOT fall back to full_name. Every account is
 * backfilled with a handle (migration 0168), so (1) is essentially
 * always hit; (2)/(3) are belt-and-suspenders.
 *
 * full_name / email remain available for PRIVATE, legitimate uses
 * (campaign mailto sender name, the user's own dashboard greeting) —
 * just never through this function.
 */
export function publicHandle(
  p?: { username?: string | null; state?: string | null } | null,
): string {
  if (p?.username && p.username.trim()) return `@${p.username.trim()}`;
  if (p?.state && p.state.trim()) return `Advocate from ${p.state.trim()}`;
  return "Member";
}

/** Initials for an avatar bubble, derived from the public handle only
 *  (never the real name). "@nash_oh" → "NA", "Member" → "M". */
export function handleInitials(handle: string): string {
  const core = handle.replace(/^@/, "").replace(/^Advocate from\s+/i, "");
  const letters = core.replace(/[^a-zA-Z0-9]/g, "");
  return (letters.slice(0, 2) || "M").toUpperCase();
}

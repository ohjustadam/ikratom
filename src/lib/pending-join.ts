/**
 * Carries a group invite through signup.
 *
 * A new person who scans a group's QR code has no account, so they sign up
 * first. The confirmation email lands them back on the site, but its link
 * cannot carry the invite, so before this they arrived on /account and the
 * group was lost (found 2026-11-03, Rein In Chaos). Signup now remembers the
 * invite code in this cookie, and the first page after confirming or signing
 * in takes them to the invite, which joins them in one step.
 */
export const PENDING_JOIN_COOKIE = "pending_join";
export const PENDING_JOIN_MAX_AGE = 14 * 86_400;

const CODE_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** The invite code in a `/coalitions/join/<code>` path, or null. */
export function joinCodeFromPath(path: string | null | undefined): string | null {
  const m = /^\/coalitions\/join\/([^/?#]+)/.exec(String(path ?? ""));
  return m && CODE_RE.test(m[1]) ? m[1] : null;
}

/** Where a remembered invite sends the member: the join page, set to join at once. */
export function pendingJoinPath(cookieValue: string | null | undefined): string | null {
  const code = String(cookieValue ?? "");
  return CODE_RE.test(code) ? `/coalitions/join/${code}?auto=1` : null;
}

export const pendingJoinCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: PENDING_JOIN_MAX_AGE,
};

/**
 * Belt-and-suspenders MFA gate for sensitive admin mutations.
 *
 * Returns `null` if the caller is allowed to mutate, or a string error
 * message if they should be blocked. Rules:
 *
 *   - If the user has NO factors enrolled (`aalNext === "aal1"`): allowed.
 *     This is a transitional grace period — admins are nudged in the UI to
 *     enroll, but not locked out.
 *
 *   - If the user HAS factors (`aalNext === "aal2"`) but the current session
 *     is at aal1: blocked. They need to re-authenticate via /login/mfa.
 *
 *   - If the user is at aal2: allowed.
 *
 * Once 100% of admin accounts have factors enrolled, flip the first rule to
 * also block — making MFA mandatory for any admin mutation.
 *
 * NOTE: kept in a non-"use server" file because server-actions files can
 * only export async functions; this is a plain sync helper.
 */
export function requireMfaForMutation(ctx: {
  aal: "aal1" | "aal2" | null;
  aalNext: "aal1" | "aal2" | null;
  mfaBypass?: boolean;
}): string | null {
  // Backup-code redemption grants a 1-hour bypass for the current session.
  if (ctx.mfaBypass) return null;
  if (ctx.aalNext === "aal2" && ctx.aal !== "aal2") {
    return "Two-factor verification required. Visit /login/mfa to enter your code, then try again.";
  }
  return null;
}

/**
 * Stricter gate (anti-weaponization PR4): MFA is MANDATORY, not optional.
 * Used for high-leverage authoring by advocate leaders — the tier most
 * exposed to infiltration. Unlike requireMfaForMutation, a leader with NO
 * factors enrolled is blocked (not grace-allowed) and told to enroll.
 * Admins/owner keep the softer gate so an un-enrolled owner can't lock
 * themselves out of authoring (flip them over once all admins have 2FA).
 */
export function requireMfaEnrolled(ctx: {
  aal: "aal1" | "aal2" | null;
  aalNext: "aal1" | "aal2" | null;
  mfaBypass?: boolean;
}): string | null {
  if (ctx.mfaBypass) return null;
  if (ctx.aalNext !== "aal2") {
    return "Two-factor authentication is required to author campaigns or waves. Enroll at /account/security, then try again.";
  }
  if (ctx.aal !== "aal2") {
    return "Two-factor verification required. Visit /login/mfa to enter your code, then try again.";
  }
  return null;
}

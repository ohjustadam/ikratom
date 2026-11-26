/** Shown to an admin or owner with no verified factor. Deliberately does NOT
 * start with "Two-factor verification required": that prefix opens the inline
 * code prompt (src/lib/mfa-error.ts), which is useless with no factor. */
export const ADMIN_MFA_ENROLL_MESSAGE =
  "Two-factor authentication is required for admin changes. Enroll at /account/security, then try again.";

/**
 * Whether an admin or owner with NO verified factor is blocked from mutating.
 * On since the owner's go on 2026-11-25 (members were told Nov 23 by email +
 * bell note on 2026-11-16). Setting it false restores the grace rule.
 */
export const ADMIN_MFA_ENFORCED = true;

/**
 * MFA gate for sensitive admin mutations.
 *
 * Returns `null` if the caller is allowed to mutate, or a string error
 * message if they should be blocked. Rules:
 *
 *   - Backup-code bypass cookie (signed, 1 hour): allowed.
 *   - Admin or owner with NO verified factor (`aalNext !== "aal2"`): blocked
 *     and told to enroll at /account/security (ADMIN_MFA_ENFORCED, on since
 *     2026-11-25). The owner has a factor, so this cannot lock him out.
 *   - Anyone WITH a factor whose session is still aal1: blocked until they
 *     enter their code (/login/mfa or the inline prompt).
 *   - Otherwise allowed. A plain leader acting on a granted permission keeps
 *     the old grace rule; campaign/wave authoring uses requireMfaEnrolled.
 *
 * `enforce` overrides ADMIN_MFA_ENFORCED (tests only).
 *
 * NOTE: kept in a non-"use server" file because server-actions files can
 * only export async functions; this is a plain sync helper.
 */
export function requireMfaForMutation(ctx: {
  aal: "aal1" | "aal2" | null;
  aalNext: "aal1" | "aal2" | null;
  mfaBypass?: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  enforce?: boolean;
}): string | null {
  // Backup-code redemption grants a 1-hour bypass for the current session.
  if (ctx.mfaBypass) return null;
  const enforced = ctx.enforce ?? ADMIN_MFA_ENFORCED;
  if (enforced && (ctx.isAdmin || ctx.isOwner) && ctx.aalNext !== "aal2") {
    return ADMIN_MFA_ENROLL_MESSAGE;
  }
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

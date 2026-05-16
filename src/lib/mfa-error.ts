/**
 * Helper to detect when a server-action error means "MFA step-up required."
 *
 * Owner directive 2026-05-16: "anytime we receive this message to re auth
 * for 2step, that you bring up a popup auth window that doesnt redirect
 * to another page so it can be completed right then and there. this should
 * be the case SITE WIDE for anything like this with 2step auth."
 *
 * The server-side gate (src/modules/admin/mfa.ts::requireMfaForMutation)
 * returns the message starting with "Two-factor verification required".
 * src/modules/auth/actions-password.ts has another instance for password
 * change. We detect either by prefix — strict substring match keeps it
 * simple and avoids breaking changes to ~20 admin actions.
 *
 * Usage on the client:
 *
 *   const result = await someAdminAction(...);
 *   if (wasMfaRequired(result.error)) {
 *     const ok = await requireMfa();
 *     if (!ok) return;
 *     // retry the action
 *     const retry = await someAdminAction(...);
 *     // handle retry result
 *   }
 */
export function wasMfaRequired(error: string | undefined | null): boolean {
  if (!error) return false;
  return error.startsWith("Two-factor verification required");
}

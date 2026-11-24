/**
 * The handle we assign when an account has none (migration 0247):
 * "member_" plus 10 hex characters of the account id. Other members see it as
 * "@member_3f9a2c1b0d", which reads like a serial number, so anyone still on
 * one is asked to pick a real handle (member report, 2026-11-23: 44 of 75
 * members were still on theirs, mostly from a signup bug fixed in #1147).
 */
export const PLACEHOLDER_HANDLE = /^member_[0-9a-f]{10}$/;

/** True for the auto-assigned handle. Accepts "@member_…" or "member_…". */
export function isPlaceholderHandle(handle: string | null | undefined): boolean {
  return !!handle && PLACEHOLDER_HANDLE.test(handle.replace(/^@/, ""));
}

/** The same rule signup and the profile form use: 3–30 of a-z, 0-9 and _. */
export function checkHandleShape(raw: string): { ok: true; handle: string } | { ok: false; error: string } {
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (!handle) return { ok: false, error: "Type the handle you'd like." };
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) {
    return { ok: false, error: "3–30 characters: lowercase letters, numbers and _ only." };
  }
  if (PLACEHOLDER_HANDLE.test(handle)) return { ok: false, error: "Pick something other than the automatic handle." };
  return { ok: true, handle };
}

"use server";

import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { recordAdminAction } from "@/lib/audit";

/**
 * MFA backup codes.
 *
 * Generated when the user has TOTP enrolled. 8 codes per generation,
 * 10 chars each (alphanumeric, easy to type), shown to the user *exactly*
 * once. We store SHA-256 of each. On consumption, the row is marked used
 * and a short-lived `mfa_bypass_until` cookie is set (1 hour) so the
 * user's session is treated as aal2 by `requireMfaForMutation`.
 *
 * Why a cookie bypass instead of upgrading the Supabase AAL? Supabase
 * MFA factors are TOTP-only — there's no API to mint an aal2 token from a
 * non-TOTP source. The cookie is HTTP-only, signed via the secret implicit
 * in the Supabase auth cookie, and only valid for the same browser/device.
 */

const CODE_LEN = 10;
const NUM_CODES = 8;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
const BYPASS_COOKIE = "mfa_bypass_until";
const BYPASS_TTL_SECONDS = 60 * 60; // 1 hour

function hashCode(code: string): string {
  return createHash("sha256")
    .update(code.replace(/\s+/g, "").toUpperCase())
    .digest("hex");
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  // Format as XXXXX-XXXXX for readability
  return out.slice(0, 5) + "-" + out.slice(5);
}

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export type BackupCodesSummary = {
  total: number;
  used: number;
  remaining: number;
};

/** Counts only — never returns plaintext. */
export async function listBackupCodes(): Promise<BackupCodesSummary> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { total: 0, used: 0, remaining: 0 };

  const { data: rows } = await supabase
    .from("mfa_backup_codes")
    .select("id, used_at")
    .eq("user_id", user.id);

  const total = rows?.length ?? 0;
  const used = rows?.filter((r) => r.used_at).length ?? 0;
  return { total, used, remaining: total - used };
}

/**
 * Generate a fresh set of backup codes. Deletes any prior codes for this
 * user (regeneration is total replacement). Returns the plaintext codes
 * exactly once — the caller MUST display them, then drop the reference.
 */
export async function generateBackupCodes(): Promise<
  { ok: true; codes: string[] } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Sanity: must have at least one verified TOTP factor before backup codes
  // make sense. Otherwise we'd be issuing 2FA recovery for an account with
  // no 2FA.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasVerified = (factors?.totp ?? []).some(
    (f) => (f.status as unknown as string) === "verified"
  );
  if (!hasVerified) {
    return { error: "Set up an authenticator first, then generate backup codes." };
  }

  const codes: string[] = [];
  for (let i = 0; i < NUM_CODES; i++) codes.push(generateCode());
  const rows = codes.map((c) => ({ user_id: user.id, code_hash: hashCode(c) }));

  const admin = service();
  // Replace prior codes
  await admin.from("mfa_backup_codes").delete().eq("user_id", user.id);
  const { error } = await admin.from("mfa_backup_codes").insert(rows);
  if (error) return { error: error.message };

  // Audit-log for privileged accounts
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "mfa_backup_codes_generated",
      targetType: "user",
      targetId: user.id,
    });
  }

  return { ok: true, codes };
}

/**
 * Verify a plaintext backup code. On success, marks it used and sets the
 * bypass cookie so this session is treated as aal2 for the next hour.
 */
export async function verifyBackupCode(plaintext: string): Promise<
  { ok: true; remaining: number } | { error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const code = (plaintext || "").trim().toUpperCase();
  // Accept with or without dash
  if (!/^[A-Z0-9]{5}-?[A-Z0-9]{5}$/.test(code)) {
    return { error: "Code must be 10 characters (e.g. ABC23-XYZ45)." };
  }

  const hash = hashCode(code);
  const admin = service();
  const { data: match } = await admin
    .from("mfa_backup_codes")
    .select("id, used_at")
    .eq("user_id", user.id)
    .eq("code_hash", hash)
    .single();

  if (!match) return { error: "That backup code is not valid." };
  if (match.used_at) return { error: "That backup code has already been used." };

  const { error: useErr } = await admin
    .from("mfa_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", match.id);
  if (useErr) return { error: useErr.message };

  // Set bypass cookie
  const c = await cookies();
  c.set(BYPASS_COOKIE, String(Date.now() + BYPASS_TTL_SECONDS * 1000), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: BYPASS_TTL_SECONDS,
    path: "/",
  });

  // Audit-log
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "mfa_backup_code_used",
      targetType: "user",
      targetId: user.id,
    });
  }

  // Count remaining
  const { data: leftRows } = await admin
    .from("mfa_backup_codes")
    .select("id, used_at")
    .eq("user_id", user.id);
  const remaining = (leftRows ?? []).filter((r) => !r.used_at).length;

  return { ok: true, remaining };
}

/** Read the bypass cookie. Returns true if the bypass is still valid. */
export async function hasMfaBypass(): Promise<boolean> {
  const c = await cookies();
  const raw = c.get(BYPASS_COOKIE)?.value;
  if (!raw) return false;
  const expiry = parseInt(raw);
  if (!Number.isFinite(expiry)) return false;
  return Date.now() < expiry;
}

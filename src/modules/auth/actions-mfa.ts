"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";

/**
 * MFA — TOTP only (authenticator app: Google Authenticator, 1Password, etc.).
 *
 * Lifecycle:
 *   1. listMfa()     → see existing factors + current AAL
 *   2. enrollTotp()  → creates an unverified factor, returns QR + secret
 *   3. verifyTotp()  → user scans QR, enters 6-digit code, factor is activated
 *   4. unenrollMfa() → remove a factor (still requires the user to be signed in)
 *
 * After verifyTotp() succeeds, the session AAL upgrades to aal2. Admin
 * mutations check AAL via requireAdminAal2() in the admin actions.
 */

export type MfaSummary = {
  aal: "aal1" | "aal2" | null;
  nextAal: "aal1" | "aal2" | null;
  factors: Array<{
    id: string;
    friendlyName: string | null;
    status: "verified" | "unverified";
    createdAt: string;
  }>;
};

export async function listMfa(): Promise<MfaSummary> {
  const supabase = await createClient();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const totp = factorsData?.totp ?? [];
  return {
    aal: (aalData?.currentLevel as "aal1" | "aal2" | null) ?? null,
    nextAal: (aalData?.nextLevel as "aal1" | "aal2" | null) ?? null,
    factors: totp.map((f) => ({
      id: f.id,
      friendlyName: f.friendly_name ?? null,
      status: (f.status as unknown as "verified" | "unverified"),
      createdAt: f.created_at,
    })),
  };
}

export type EnrollResult =
  | { error: string }
  | { factorId: string; qrSvg: string; secret: string; uri: string };

/** Start TOTP enrollment. Creates an unverified factor + returns QR/secret. */
export async function enrollTotp(friendlyName?: string): Promise<EnrollResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Clean up any leftover unverified factors so the user doesn't accumulate
  // them if they bail mid-flow. Verified factors are left alone. Supabase's
  // TS types narrow status to "verified", but the API also returns
  // "unverified" — cast through unknown to read it.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.totp ?? []) {
    if ((f.status as unknown as string) !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: (friendlyName || "Authenticator").slice(0, 80),
  });
  if (error || !data) return { error: error?.message ?? "Enrollment failed." };

  return {
    factorId: data.id,
    qrSvg: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export type VerifyResult = { ok: true } | { error: string };

/** Verify the 6-digit code against an unverified factor → activates it. */
export async function verifyTotp(input: { factorId: string; code: string }): Promise<VerifyResult> {
  const supabase = await createClient();
  const code = (input.code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return { error: "Code must be 6 digits." };
  if (!input.factorId) return { error: "Missing factor id." };

  const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
    factorId: input.factorId,
  });
  if (chErr || !challenge) return { error: chErr?.message ?? "Could not start challenge." };

  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId: input.factorId,
    challengeId: challenge.id,
    code,
  });
  if (vErr) return { error: vErr.message };

  // Audit-log MFA enrollment for admin accountability
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("is_admin, is_owner, is_advocate_leader")
        .eq("id", user.id)
        .single()
    : { data: null };
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "mfa_enrolled",
      targetType: "user",
      targetId: user!.id,
    });
  }

  revalidatePath("/account/security");
  return { ok: true };
}

/** Remove a factor. */
export async function unenrollMfa(factorId: string): Promise<VerifyResult> {
  if (!factorId) return { error: "Missing factor id." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) return { error: error.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader) {
    await recordAdminAction({
      action: "mfa_removed",
      targetType: "user",
      targetId: user.id,
      details: { factorId },
    });
  }

  revalidatePath("/account/security");
  return { ok: true };
}

/**
 * Challenge an existing verified factor and verify a code in one step.
 * Used during sign-in step-up flows when the session is at aal1 but the
 * user has aal2 available. Returns ok on successful upgrade.
 */
export async function challengeAndVerify(input: {
  factorId: string;
  code: string;
}): Promise<VerifyResult> {
  return verifyTotp(input);
}

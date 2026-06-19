import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Trust tiers (anti-weaponization PR4).
 *
 * The platform stays open — anyone can sign up and email their own
 * legislators immediately (that's the mission). But the HIGH-LEVERAGE
 * surfaces (coordinated wave amplification, campaign authoring, becoming an
 * Advocate Leader) sit behind escalating commitment, so a drive-by opponent
 * can't cheaply turn the tool against kratom:
 *
 *   new       — signed up < 48h ago, or missing verification requirements.
 *   verified  — confirmed email + complete profile + 2FA enrolled + ≥48h old.
 *   leader/admin/owner — existing roles (higher trust).
 *
 * Each gate is generic trust-and-safety: it screens by commitment, never by
 * viewpoint. The 48h age-moat applies ONLY to amplification — basic
 * "email your reps" is never gated (don't kneecap new-advocate activation).
 */

export const MIN_ACCOUNT_AGE_HOURS = 48;

type ProfileBits = {
  full_name?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
} | null;

/** Hours since signup. Fail-open (returns Infinity) on missing/bad data —
 *  this is a soft moat, not an auth boundary; a data glitch must not lock a
 *  legitimate signed-in user out of participating. */
export function accountAgeHours(createdAt?: string | null): number {
  if (!createdAt) return Infinity;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

export function accountAgeOk(createdAt?: string | null): boolean {
  return accountAgeHours(createdAt) >= MIN_ACCOUNT_AGE_HOURS;
}

/** "Filled out their profile in full" — name + a complete mailing address
 *  (what campaign templates render). Tunable: this is the single definition
 *  of profile-complete used across the tier system. */
export function isProfileComplete(p: ProfileBits): boolean {
  return !!(p && p.full_name && p.street && p.city && p.state && p.zip);
}

export function missingProfileFields(p: ProfileBits): string[] {
  const out: string[] = [];
  if (!p?.full_name) out.push("full name");
  if (!p?.street) out.push("street");
  if (!p?.city) out.push("city");
  if (!p?.state) out.push("state");
  if (!p?.zip) out.push("ZIP");
  return out;
}

export type TrustTier = "anon" | "new" | "verified" | "leader" | "admin" | "owner";

export type TrustInfo = {
  tier: TrustTier;
  role: "user" | "leader" | "admin" | "owner";
  ageOk: boolean;
  ageHours: number;
  emailConfirmed: boolean;
  profileComplete: boolean;
  mfaEnrolled: boolean;
  /** True when a plain user meets every "verified" requirement. */
  verified: boolean;
};

/**
 * Compute the current user's tier. Best-effort; never throws. For dashboards,
 * badges, and gating decisions in server components / actions.
 */
export async function getTrustTier(): Promise<TrustInfo> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { tier: "anon", role: "user", ageOk: false, ageHours: 0, emailConfirmed: false, profileComplete: false, mfaEnrolled: false, verified: false };
  }

  const [{ data: profile }, { data: aal }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, street, city, state, zip, is_admin, is_owner, is_advocate_leader")
      .eq("id", user.id)
      .single(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const mfaEnrolled = aal?.nextLevel === "aal2";
  const emailConfirmed = !!user.email_confirmed_at;
  const ageHours = accountAgeHours(user.created_at);
  const ageOk = ageHours >= MIN_ACCOUNT_AGE_HOURS;
  const profileComplete = isProfileComplete(profile);

  const role: TrustInfo["role"] = profile?.is_owner
    ? "owner"
    : profile?.is_admin
      ? "admin"
      : profile?.is_advocate_leader
        ? "leader"
        : "user";

  const verified = emailConfirmed && ageOk && profileComplete && mfaEnrolled;
  const tier: TrustTier = role !== "user" ? role : verified ? "verified" : "new";

  return { tier, role, ageOk, ageHours, emailConfirmed, profileComplete, mfaEnrolled, verified };
}

/**
 * Cross-user verification check, used to gate Advocate Leader promotion so a
 * thin/astroturf account can't be handed the authoring + amplification keys.
 * Service-role (reads another user's auth record + profile). Returns the list
 * of unmet requirements for a clear admin-facing message.
 */
export async function verifyUserForPromotion(
  userId: string,
): Promise<{ ok: boolean; missing: string[] }> {
  const sr = createServiceRoleClient();
  const missing: string[] = [];

  const { data: got, error } = await sr.auth.admin.getUserById(userId);
  const u = got?.user;
  if (error || !u) return { ok: false, missing: ["account not found"] };

  if (!u.email_confirmed_at) missing.push("confirmed email");
  if (!accountAgeOk(u.created_at)) missing.push("account age ≥ 48h");

  const factors = (u.factors ?? []) as Array<{ status?: string }>;
  if (!factors.some((f) => f.status === "verified")) missing.push("2FA enrolled");

  const { data: profile } = await sr
    .from("profiles")
    .select("full_name, street, city, state, zip")
    .eq("id", userId)
    .single();
  if (!isProfileComplete(profile)) {
    missing.push(`complete profile (${missingProfileFields(profile).join(", ")})`);
  }

  return { ok: missing.length === 0, missing };
}

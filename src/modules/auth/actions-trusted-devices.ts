"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";
import { getClientIp } from "@/lib/rate-limit";
import {
  TRUSTED_DEVICE_COOKIE,
  DEFAULT_TRUST_DAYS,
  generateDeviceId,
  signTrustedCookie,
  verifyTrustedCookie,
  summarizeUserAgent,
} from "@/lib/trusted-device";

/**
 * "Remember this device" — opt-in trust after a successful MFA
 * verification, so the user skips the /login/mfa challenge on routine
 * sign-ins from this browser.
 *
 * Only skips the routine challenge — sensitive actions that require
 * fresh aal2 (admin mutations, password change, MFA management) still
 * re-prompt for the TOTP code. That's the standard pattern.
 */

export async function trustThisDevice(opts?: { days?: number }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  // The caller is supposed to invoke this immediately after a successful
  // MFA verify in the same request flow. Defense-in-depth: re-check the
  // session aal so a malicious client can't trust a device without
  // having actually completed MFA.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") {
    return { error: "MFA verification required to trust a device." };
  }

  const days = Math.min(Math.max(opts?.days ?? DEFAULT_TRUST_DAYS, 1), 90);
  const expiresAtMs = Date.now() + days * 24 * 60 * 60 * 1000;
  const deviceId = generateDeviceId();

  const h = await headers();
  const ua = h.get("user-agent");
  const ip = await getClientIp();

  // Insert DB row first so the cookie is never valid without a backing row
  const { error } = await supabase.from("trusted_devices").insert({
    user_id: user.id,
    device_id: deviceId,
    ua_summary: summarizeUserAgent(ua),
    ip_seen: ip.slice(0, 64),
    expires_at: new Date(expiresAtMs).toISOString(),
  });
  if (error) return { error: error.message };

  // Sign + set the cookie
  const cookieValue = signTrustedCookie({ userId: user.id, deviceId, expiresAtMs });
  if (!cookieValue) {
    // CRON_SECRET not configured — undo the row and bail
    await supabase.from("trusted_devices").delete().eq("user_id", user.id).eq("device_id", deviceId);
    return { error: "Trusted-device signing key not configured." };
  }

  const cookieStore = await cookies();
  cookieStore.set(TRUSTED_DEVICE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: days * 24 * 60 * 60,
    path: "/",
  });

  await recordAdminAction({
    action: "user.trust_device",
    targetType: "user",
    targetId: user.id,
    details: { ua_summary: summarizeUserAgent(ua), days },
  });
  return { ok: true };
}

/**
 * Called from the sign-in flow BEFORE redirecting to /login/mfa. If the
 * cookie is valid + matches a non-expired row in trusted_devices for
 * this user, returns true (caller should skip the MFA challenge).
 *
 * Side effect: bumps last_used_at on the matching row.
 */
export async function isCurrentDeviceTrusted(userId: string): Promise<boolean> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value;
  const payload = verifyTrustedCookie(raw);
  if (!payload) return false;
  if (payload.userId !== userId) return false;

  // HMAC + expiry passed — confirm a row exists in the DB. The HMAC
  // alone is sufficient for trust, but DB row gives us a revoke surface
  // and last-used tracking.
  const supabase = await createClient();
  const { data } = await supabase
    .from("trusted_devices")
    .select("id, expires_at")
    .eq("user_id", payload.userId)
    .eq("device_id", payload.deviceId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) return false;

  // Fire-and-forget: bump last_used_at
  supabase
    .from("trusted_devices")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return true;
}

export async function listMyTrustedDevices() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("trusted_devices")
    .select("id, device_id, ua_summary, ip_seen, last_used_at, expires_at, created_at")
    .eq("user_id", user.id)
    .gt("expires_at", new Date().toISOString())
    .order("last_used_at", { ascending: false });

  // Mark which row is the CURRENT device so the UI can label it
  const cookieStore = await cookies();
  const raw = cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value;
  const payload = verifyTrustedCookie(raw);
  const currentDeviceId = payload?.userId === user.id ? payload.deviceId : null;

  return ((data ?? []) as Array<{
    id: string;
    device_id: string;
    ua_summary: string | null;
    ip_seen: string | null;
    last_used_at: string;
    expires_at: string;
    created_at: string;
  }>).map((d) => ({
    ...d,
    is_current: d.device_id === currentDeviceId,
  }));
}

export async function revokeTrustedDevice(rowId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  if (!/^[0-9a-f-]{36}$/i.test(rowId)) return { error: "Invalid id." };

  // Look up the row first so we know its device_id (so we can clear
  // the cookie if the user is revoking their CURRENT device).
  const { data: row } = await supabase
    .from("trusted_devices")
    .select("device_id")
    .eq("id", rowId)
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase
    .from("trusted_devices")
    .delete()
    .eq("id", rowId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  // If they revoked the current device, clear the cookie too
  if (row?.device_id) {
    const cookieStore = await cookies();
    const raw = cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value;
    const payload = verifyTrustedCookie(raw);
    if (payload?.deviceId === row.device_id) {
      cookieStore.delete(TRUSTED_DEVICE_COOKIE);
    }
  }

  await recordAdminAction({
    action: "user.revoke_trusted_device",
    targetType: "user",
    targetId: user.id,
  });
  revalidatePath("/account/security");
  return { ok: true };
}

/**
 * Revoke ALL trusted devices for the current user. "Sign me out
 * everywhere"-flavored. The cookie is also cleared.
 */
export async function revokeAllTrustedDevices() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };
  const { error } = await supabase
    .from("trusted_devices")
    .delete()
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  const cookieStore = await cookies();
  cookieStore.delete(TRUSTED_DEVICE_COOKIE);

  await recordAdminAction({
    action: "user.revoke_all_trusted_devices",
    targetType: "user",
    targetId: user.id,
  });
  revalidatePath("/account/security");
  return { ok: true };
}

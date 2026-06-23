import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server";

/**
 * MFA-bypass cookie — SIGNED + user-bound.
 *
 * When a user clears 2FA via a non-TOTP path (backup code, or just-verified
 * TOTP whose new aal2 JWT hasn't round-tripped to the cookie store yet), we set
 * a short-lived cookie that `requireMfaForMutation` treats as aal2.
 *
 * SECURITY (pen-test MFA-001): the cookie used to be the bare plaintext
 * `String(Date.now()+ttl)`. httpOnly only stops the VICTIM's JS from reading it
 * — it does nothing against an attacker crafting their own requests, who could
 * just send `Cookie: mfa_bypass_until=9999999999999` to forge the 2FA gate on an
 * admin session they'd phished the password for. We now HMAC the expiry + the
 * user id with a server secret and verify it (constant-time) against the CURRENT
 * user, so the value is unforgeable and can't be replayed onto another account.
 */

const BYPASS_COOKIE = "mfa_bypass_until";
const BYPASS_TTL_SECONDS = 60 * 60; // 1 hour
// Server-only secret. CRON_SECRET is always set server-side; never shipped to
// the browser. (Falls back to the service-role key so we never sign with "".)
const SECRET = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function sign(userId: string, expiryMs: number): string {
  return createHmac("sha256", SECRET).update(`${userId}.${expiryMs}`).digest("hex");
}

/** Set the signed, user-bound bypass cookie (call after a verified non-TOTP MFA step). */
export async function setMfaBypassCookie(userId: string): Promise<void> {
  const expiryMs = Date.now() + BYPASS_TTL_SECONDS * 1000;
  const c = await cookies();
  c.set(BYPASS_COOKIE, `${expiryMs}.${sign(userId, expiryMs)}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: BYPASS_TTL_SECONDS,
    path: "/",
  });
}

/** True iff a valid, unexpired, HMAC-verified bypass cookie exists for the CURRENT user. */
export async function hasMfaBypass(): Promise<boolean> {
  if (!SECRET) return false; // fail closed if misconfigured
  const c = await cookies();
  const raw = c.get(BYPASS_COOKIE)?.value;
  if (!raw) return false;
  const dot = raw.indexOf(".");
  if (dot < 1) return false;
  const expiry = parseInt(raw.slice(0, dot), 10);
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return false;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const expected = sign(user.id, expiry);
  let a: Buffer, b: Buffer;
  try { a = Buffer.from(sig, "hex"); b = Buffer.from(expected, "hex"); }
  catch { return false; }
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

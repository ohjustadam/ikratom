import { createHmac, randomBytes, timingSafeEqual } from "crypto";

/**
 * Trusted-device cookie sign + verify.
 *
 * Cookie name:  td
 * Cookie value: <user_id>.<device_id>.<expiresAtMs>.<hmac>
 *
 * HMAC uses CRON_SECRET as the signing key — already a high-entropy
 * server-only secret. If CRON_SECRET ever rotates, all trusted-device
 * cookies become invalid (forcing fresh MFA on next sign-in), which is
 * acceptable behavior.
 *
 * Verification is constant-time (timingSafeEqual). Expiry is checked
 * AFTER the HMAC to avoid an oracle on validity.
 */

export const TRUSTED_DEVICE_COOKIE = "td";
export const DEFAULT_TRUST_DAYS = 30;
const HMAC_ALG = "sha256";

function getKey(): Buffer | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return Buffer.from(secret, "utf8");
}

export function generateDeviceId(): string {
  // 32 bytes = 64 hex chars. Matches the table's CHECK constraint.
  return randomBytes(32).toString("hex");
}

export type TrustedCookiePayload = {
  userId: string;
  deviceId: string;
  expiresAtMs: number;
};

export function signTrustedCookie(payload: TrustedCookiePayload): string | null {
  const key = getKey();
  if (!key) return null;
  const body = `${payload.userId}.${payload.deviceId}.${payload.expiresAtMs}`;
  const mac = createHmac(HMAC_ALG, key).update(body).digest("hex");
  return `${body}.${mac}`;
}

export function verifyTrustedCookie(value: string | undefined): TrustedCookiePayload | null {
  if (!value) return null;
  const key = getKey();
  if (!key) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [userId, deviceId, expStr, mac] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  if (!/^[a-f0-9]{32,80}$/i.test(deviceId)) return null;

  const expiresAtMs = Number(expStr);
  if (!Number.isFinite(expiresAtMs)) return null;

  const expectedMac = createHmac(HMAC_ALG, key)
    .update(`${userId}.${deviceId}.${expiresAtMs}`)
    .digest("hex");

  // Constant-time compare. Bail if lengths differ (timingSafeEqual throws).
  if (mac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(expectedMac, "hex"))) {
    return null;
  }

  // HMAC valid — now check expiry.
  if (expiresAtMs < Date.now()) return null;

  return { userId, deviceId, expiresAtMs };
}

export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  // Lazy parse — extract platform + browser hint so the user can
  // recognize the row in /account/security.
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
    ? "Chrome"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /Safari\//.test(ua) && !/Chrome\//.test(ua)
    ? "Safari"
    : "Browser";
  const os = /Windows/i.test(ua)
    ? "Windows"
    : /Mac OS X/i.test(ua) || /Macintosh/i.test(ua)
    ? "macOS"
    : /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad/i.test(ua)
    ? "iOS"
    : /Linux/i.test(ua)
    ? "Linux"
    : "OS?";
  return `${browser} on ${os}${isMobile ? " (mobile)" : ""}`;
}

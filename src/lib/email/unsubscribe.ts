import crypto from "node:crypto";

/**
 * One-click email unsubscribe tokens.
 *
 * MIRROR of scripts/lib/email-send.mjs `unsubscribeToken` — the cron that
 * sends the email builds the link, this verifies it. Keep the two identical.
 * Keyed off CRON_SECRET (already present in Actions, Netlify and .env.local)
 * so turning this on needed no new secret.
 */
export function unsubscribeToken(userId: string): string {
  const key = crypto.createHmac("sha256", process.env.CRON_SECRET || "").update("email-unsubscribe-v1").digest();
  return crypto.createHmac("sha256", key).update(userId).digest("base64url").slice(0, 32);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time check; false for anything malformed or when CRON_SECRET is unset. */
export function verifyUnsubscribe(userId: string | null, token: string | null): boolean {
  if (!process.env.CRON_SECRET || !userId || !token || !UUID_RE.test(userId)) return false;
  const expected = Buffer.from(unsubscribeToken(userId));
  const given = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

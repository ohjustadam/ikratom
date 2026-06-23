import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "crypto";

/**
 * At-rest encryption for OAuth refresh tokens (pen-test oauth-02).
 *
 * Gmail/Outlook send-on-behalf refresh tokens were stored as plaintext in
 * email_integrations, so a DB backup / service-role-scoped leak / SQL-injection
 * with the service role would let an attacker send mail as every connected user.
 * We now AES-256-GCM the token before it touches the table.
 *
 * KEY: derived (HKDF-SHA256) from CRON_SECRET — a server-only env value that is
 * NOT in the database. So the exact threat in the finding (DB/backup/service-role
 * exposure WITHOUT an app-env compromise) no longer yields usable tokens. We
 * derive a dedicated subkey rather than using CRON_SECRET directly, so this use
 * is cryptographically isolated from CRON_SECRET's other uses.
 *
 * Format: "v1:" + base64(iv[12] ‖ authTag[16] ‖ ciphertext). decryptToken is
 * backward-compatible: a value without the "v1:" prefix is treated as legacy
 * plaintext and returned as-is, so the send path keeps working during/after the
 * one-time backfill. A value that fails to decrypt returns "" (forces reconnect)
 * rather than throwing.
 */

const PREFIX = "v1:";

function deriveKey(): Buffer {
  const secret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from("ikratom-oauth-token-v1"), 32),
  );
}

/** Encrypt a token for storage. Empty/falsy input passes through unchanged. */
export function encryptToken(plain: string | null | undefined): string {
  if (!plain) return plain ?? "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored token. Legacy plaintext (no prefix) passes through. */
export function decryptToken(stored: string | null | undefined): string {
  if (!stored) return stored ?? "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return ""; // corrupt / wrong key → treat as no token (user reconnects)
  }
}

/** True if a stored value is already in the encrypted format. */
export function isEncryptedToken(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX);
}

/**
 * Check a password against HaveIBeenPwned's "Pwned Passwords" service
 * using the k-anonymity range API. The plaintext password is NEVER sent
 * over the wire — we send only the first 5 hex chars of the SHA-1 hash
 * and scan the response for the remaining 35 chars.
 *
 * Free service, no auth, no key, unlimited usage. Docs:
 *   https://haveibeenpwned.com/API/v3#PwnedPasswords
 *
 * Usage:
 *   if (await isPasswordPwned(plaintext) > 0) {
 *     return { error: "This password has appeared in a known breach. Pick a different one." };
 *   }
 *
 * Network failure is FAIL-OPEN — we don't want a HIBP outage to lock
 * users out of signup. Worst case we accept a breached password; the
 * other defenses (rate limits, MFA, password floor) still apply.
 */

import { createHash } from "crypto";

const HIBP_BASE = "https://api.pwnedpasswords.com/range/";

/**
 * Returns the breach count for the given password. 0 = not found in any
 * known breach. Returns 0 on network/parse error (fail-open).
 *
 * Optional opts.timeoutMs caps the wait; default 3 seconds.
 */
export async function pwnedPasswordCount(
  password: string,
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  if (!password) return 0;

  // SHA-1 the plaintext, uppercase hex
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const res = await fetch(HIBP_BASE + prefix, {
      headers: {
        // Identify ourselves so HIBP can rate-limit / contact if abused
        "User-Agent": "iKratom-PasswordCheck/1.0",
        // Add padding to make response sizes uniform (prevents timing inference
        // about which prefix bucket was queried)
        "Add-Padding": "true",
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3_000),
    });

    if (!res.ok) {
      // 4xx = our bug; 5xx = HIBP outage. Fail-open.
      return 0;
    }
    const text = await res.text();
    return parseRangeResponse(text, suffix);
  } catch {
    // Timeout, DNS failure, etc. — fail-open
    return 0;
  }
}

/**
 * Convenience: returns true iff the password appears in HIBP at least
 * `minCount` times. Default threshold of 1 means "any breach occurrence".
 *
 * For high-stakes accounts you might raise this (e.g., minCount: 100 to
 * only block heavily-breached passwords) but for our use case any
 * occurrence is reason enough to ask the user to pick another.
 */
export async function isPasswordPwned(
  password: string,
  minCount: number = 1,
): Promise<boolean> {
  const count = await pwnedPasswordCount(password);
  return count >= minCount;
}

/**
 * Parse a HIBP range response. Each line is `SUFFIX:COUNT`, sometimes
 * followed by `\r\n` or just `\n`. Returns the count for our suffix or 0
 * if not present. Padding rows have `:0` — we treat them as "not found",
 * which is correct because the actual breached entry would have count >=1.
 */
export function parseRangeResponse(body: string, wantedSuffix: string): number {
  const target = wantedSuffix.toUpperCase();
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const suffix = line.slice(0, colon).toUpperCase();
    if (suffix !== target) continue;
    const count = parseInt(line.slice(colon + 1), 10);
    return Number.isFinite(count) ? count : 0;
  }
  return 0;
}

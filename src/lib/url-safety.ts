/**
 * URL-safety helpers for SSRF defense.
 *
 * Used by any code path that fetches a URL supplied by an admin/user
 * — BoP scraper, Discord webhook sender, future "import external feed"
 * features, etc.
 *
 * Threat model:
 *   - Compromised admin account submits agenda_url = http://169.254.169.254
 *     (AWS instance metadata endpoint) to exfil cloud creds
 *   - Or http://10.0.0.1/admin (internal RDS/Redis/etc.)
 *   - Or http://localhost:8080 (Vercel function's own loopback)
 *   - Or file:///etc/passwd
 *
 * Defenses:
 *   1. Scheme allowlist (http / https only)
 *   2. Reject obvious private/loopback/link-local IP literals
 *   3. Reject "localhost" + other suspicious hostnames
 *   4. Reject non-standard ports (only :80/:443 + default)
 *
 * Note: this is a STATIC check (no DNS resolution). A determined
 * attacker could still point a public domain at a private IP via DNS
 * trickery. For high-security paths we'd add post-resolve validation;
 * for the admin-only BoP scraper, static check is the right tradeoff
 * (admins are trusted unless compromised, and they have to deliberately
 * fight past this barrier).
 */

const PRIVATE_IPV4_BLOCKS = [
  // 10.0.0.0/8
  (a: number) => a === 10,
  // 172.16.0.0/12
  (a: number, b: number) => a === 172 && b >= 16 && b <= 31,
  // 192.168.0.0/16
  (a: number, b: number) => a === 192 && b === 168,
  // 127.0.0.0/8 — loopback
  (a: number) => a === 127,
  // 169.254.0.0/16 — link-local (covers AWS IMDS at 169.254.169.254)
  (a: number, b: number) => a === 169 && b === 254,
  // 100.64.0.0/10 — carrier-grade NAT
  (a: number, b: number) => a === 100 && b >= 64 && b <= 127,
  // 0.0.0.0/8 — reserved
  (a: number) => a === 0,
];

const SUSPICIOUS_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal", // GCP IMDS
  "169.254.169.254",          // AWS / Azure IMDS (caught by IP check too)
  "metadata",                 // Catch-all for short metadata aliases
]);

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return true; // bogus = unsafe
  return PRIVATE_IPV4_BLOCKS.some((fn) => fn(a, b));
  void c; void d; // unused, kept for clarity
}

function isPrivateIpv6(host: string): boolean {
  // Strip brackets if present (in URL hostnames they wrap IPv6).
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1") return true; // loopback
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  if (h.startsWith("fe80:")) return true; // link-local
  if (h === "::" || h.startsWith("::ffff:")) return true; // unspecified / v4-mapped
  // IPv4-mapped IPv6 like ::ffff:127.0.0.1 — check the v4 portion
  const v4mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) return isPrivateIpv4(v4mapped[1]);
  return false;
}

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Validates an externally-supplied URL is safe to fetch from a server
 * context. Returns the parsed URL on success.
 *
 * Caller MUST use the returned URL.toString() — DO NOT re-parse the
 * input, since attackers can craft URLs with mixed-case schemes or
 * IDN homographs to bypass the check.
 */
export function isSafePublicUrl(raw: string): UrlSafetyResult {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "URL is required." };
  }
  if (raw.length > 2000) {
    return { ok: false, reason: "URL is too long (max 2000 chars)." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Could not parse URL." };
  }

  // 1. Scheme allowlist
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `Scheme "${url.protocol}" not allowed (http or https only).`,
    };
  }

  // 2. Reject obvious metadata / loopback hostnames
  const host = url.hostname.toLowerCase();
  if (SUSPICIOUS_HOSTNAMES.has(host)) {
    return { ok: false, reason: `Hostname "${host}" is blocked.` };
  }
  // Block any hostname that ends in .local (mDNS), .internal, .lan
  if (/\.(local|internal|lan|home|corp|intra)$/.test(host)) {
    return { ok: false, reason: `Hostname suffix on "${host}" is blocked.` };
  }

  // 3. Reject private IP literals
  if (isPrivateIpv4(host)) {
    return { ok: false, reason: "Private IPv4 addresses are blocked." };
  }
  if (isPrivateIpv6(host)) {
    return { ok: false, reason: "Private IPv6 addresses are blocked." };
  }

  // 4. Reject non-standard ports. Real state .gov sites all run on
  // 80/443. Block other ports to prevent things like
  // http://example.com:6379 (someone's exposed Redis).
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { ok: false, reason: `Port ${url.port} not allowed (80/443 only).` };
  }

  // 5. Reject "userinfo" in URL — http://attacker.com@victim.com/...
  // confuses some parsers and is rarely legitimate.
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  }

  return { ok: true, url };
}

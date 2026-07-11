/**
 * county-name.ts — sanity-check a county / parish / borough NAME before it is
 * written to a profile or used in a locality match.
 *
 * This is NOT an allowlist of real counties — the caller re-verifies that the
 * name actually maps to county-level legislators before storing it. It is just
 * a charset + length cap so an arbitrary client-supplied string can't be
 * persisted. Accepts Unicode letters (e.g. "Doña Ana County"), spaces, and the
 * punctuation that appears in real names: "St. Bernard Parish",
 * "Miami-Dade County", "Prince George's County".
 */
export function isValidCountyName(name: string): boolean {
  return /^[\p{L}][\p{L}\p{M} .'-]{1,79}$/u.test(String(name ?? "").trim());
}

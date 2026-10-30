/**
 * Where an email click at /e/<kind>/<page> lands (src/app/e/[kind]/[[...path]]).
 *
 * The destination must stay on iKratom. A path rebuilt naively from the URL
 * turns "/e/x//evil.com" into "//evil.com", which a browser reads as another
 * site: an open redirect, the thing phishing mail needs. So empty, "." and ".."
 * segments are dropped and every segment is re-encoded, which keeps "/" and "\"
 * inside a segment from starting a new host.
 */
export function clickTarget(segments: string[] | undefined, search: string): string {
  const parts = (segments ?? []).filter((s) => s && s !== "." && s !== "..").map(encodeURIComponent);
  const query = search.startsWith("?") ? search : "";
  return `/${parts.join("/")}${query}`;
}

/**
 * Allowlist of Web Push service hosts.
 *
 * A push `endpoint` is a fully attacker-controllable URL that the server later
 * POSTs to (synchronously on first subscribe, and hourly via the fanout cron).
 * Without validation, any authenticated user could register an endpoint
 * pointing at an internal host and turn the server into an SSRF proxy /
 * blind internal port scanner. Real browser push endpoints only ever belong to
 * the four push services below, so anything else is rejected. Mirrors the
 * host-allowlist guard the Discord webhook integration already applies.
 */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com", // Chrome / Chromium / Android (FCM)
  "push.services.mozilla.com", // Firefox (autopush)
  "notify.windows.com", // Edge / Windows (WNS)
  "push.apple.com", // Safari / Apple (APNs web push)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

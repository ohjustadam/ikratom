/**
 * crawl-policy.ts — the single source of truth for what crawlers are invited to.
 *
 * WHY THIS EXISTS (2026-09-18). robots.txt and sitemap.xml are two halves of one
 * decision, and they were drifting apart. robots.ts disallowed sixteen
 * high-cardinality prefixes; sitemap.ts withheld only the two families someone
 * remembered to delete by hand (bills and legislator details, each with a long
 * comment explaining why) and went on advertising the rest — ten `/intel/...`
 * pages, and up to 500 `/library/<id>`, 500 `/campaigns/<slug>` and one
 * `/briefings/<slug>` per markdown file.
 *
 * Advertising a URL you also forbid is incoherent in both directions: a
 * compliant crawler ignores the sitemap entry, and a non-compliant one takes
 * the invitation. Either way the sitemap was pointing at pages the cost-control
 * measure exists to keep un-swept.
 *
 * The fix is not to delete four more lists by hand — that is the same
 * hand-maintained guard that already failed twice here. Both files now read the
 * policy from this module, so the sitemap cannot advertise what robots forbids,
 * and when the block lifts on its own both surfaces recover together with no
 * deploy and nobody remembering.
 */

/**
 * When the cost-control crawl restriction lifts itself.
 *
 * RE-ARMED 2026-09-17 to 2026-11-16, past the owner's 60-day-untouched window.
 * The full history of why lives next to the disallow list in src/app/robots.ts;
 * the short version is that the previous expiry fired at the same instant the
 * egress cycle reset, the CDN-caching half of the plan had never shipped, and
 * egress went to ~189 MB/day against a sustainable 167.
 */
export const COST_CONTROL_EXPIRES_AT = Date.UTC(2026, 10, 16); // 2026-11-16T00:00Z

export function costControlActive(now: number = Date.now()): boolean {
  return now < COST_CONTROL_EXPIRES_AT;
}

/**
 * Private surfaces — never indexed, never advertised, on either side of the
 * expiry. These are not cost control.
 */
export const PRIVATE_PATHS = [
  "/admin/",
  "/api/",
  "/account/",
  "/messages/",
  "/dashboard/",
  "/pitch",
] as const;

/**
 * Cost-control prefixes. High-cardinality routes that are still server-rendered
 * per request, so every bot hit is a live DB read.
 *
 * NOTE THE TRAILING SLASHES, and what they do NOT cover: "/campaigns/" blocks
 * /campaigns/<slug> but leaves /campaigns itself crawlable. That is deliberate
 * for the index pages that are genuinely cheap (/campaigns is ISR 900s, /news
 * is 1800s, the state hubs are SSG) and it is a real hole for the ones that are
 * not — see the audit note in src/app/robots.ts.
 */
export const COST_CONTROL_PATHS = [
  "/legislators/",
  "/bills/",
  "/alerts/",
  "/campaigns/",
  "/forum/",
  "/meetings/",
  "/research/",
  "/library/",
  "/topics/",
  "/briefings/",
  "/coalitions/",
  "/intel/",
  "/academy/",
  "/partners/",
  "/profile/",
  "/i/",
] as const;

/** Everything robots.txt disallows right now. */
export function disallowedPaths(now: number = Date.now()): string[] {
  return [...PRIVATE_PATHS, ...(costControlActive(now) ? COST_CONTROL_PATHS : [])];
}

/**
 * Does robots.txt currently forbid this URL?
 *
 * Accepts an absolute URL or a bare path; anything unparseable is treated as
 * NOT disallowed, so a malformed entry fails toward being advertised rather
 * than silently disappearing from the sitemap.
 */
export function isDisallowed(urlOrPath: string, now: number = Date.now()): boolean {
  let pathname = urlOrPath;
  if (/^https?:\/\//i.test(urlOrPath)) {
    try { pathname = new URL(urlOrPath).pathname; } catch { return false; }
  }
  return disallowedPaths(now).some((p) => pathname.startsWith(p));
}

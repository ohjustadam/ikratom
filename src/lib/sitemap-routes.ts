/**
 * sitemap-routes.ts — which routes from the generated route manifest are safe
 * to advertise in sitemap.xml. The manifest itself comes from
 * scripts/build-route-manifest.mjs (`npm run docs:routes`).
 *
 * A route is advertised only when ALL of these hold:
 *   - no dynamic segment (one URL, not a family — families stay hand-curated
 *     in sitemap.ts because each is a cost decision, see crawl-policy.ts);
 *   - not force-dynamic and not reading searchParams (a live render per bot
 *     hit is what the crawl freeze is about) and not a bare redirect;
 *   - not login-gated and not under NEVER_ADVERTISE (admin, account, auth
 *     forms, internal tools);
 *   - robots.txt does not forbid it (isDisallowed).
 *
 * Routes already listed by hand in sitemap.ts keep their hand-set priority;
 * this only adds the ones nobody remembered to list.
 */
import manifest from "@/lib/route-manifest.generated.json";
import { isDisallowed } from "@/lib/crawl-policy";

export type ManifestRoute = {
  route: string;
  dynamic: boolean;
  forceDynamic: boolean;
  revalidate: number | null;
  usesSearchParams: boolean;
  loginGated: boolean;
  redirectOnly: boolean;
};

/**
 * Public-looking routes that must never be advertised: private areas, auth and
 * onboarding forms, internal tools, offline fallback, form-only submit pages,
 * and /search (a results surface, not content).
 */
export const NEVER_ADVERTISE: readonly string[] = [
  "/admin",
  "/account",
  "/api",
  "/dashboard",
  "/messages",
  "/leader",
  "/login",
  "/signup",
  "/forgot",
  "/reset-password",
  "/onboarding",
  "/locked",
  "/offline",
  "/embed",
  "/pitch",
  "/search",
  "/stories/new",
  "/alerts/submit",
  "/research/submit",
  "/coalitions/new",
];

function underPrefix(route: string, prefix: string): boolean {
  return route === prefix || route.startsWith(prefix + "/");
}

export function isAdvertisable(r: ManifestRoute): boolean {
  if (r.dynamic || r.forceDynamic || r.usesSearchParams || r.loginGated || r.redirectOnly) return false;
  if (NEVER_ADVERTISE.some((p) => underPrefix(r.route, p))) return false;
  return !isDisallowed(r.route);
}

/** Paths (e.g. "/glossary") the tree says are public and cheap to crawl. */
export function advertisableRoutes(routes: readonly ManifestRoute[] = manifest.routes): string[] {
  return routes.filter(isAdvertisable).map((r) => r.route);
}

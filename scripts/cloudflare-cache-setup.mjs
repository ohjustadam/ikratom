#!/usr/bin/env node
/**
 * cloudflare-cache-setup.mjs — put the edge cache in front of Netlify.
 *
 * WHY: on 2026-07-30 Netlify disabled the site for credit exhaustion. Every
 * request — including every bot crawl — reaches the origin and invokes the
 * single catch-all `___netlify-server-handler`, because the app answers with
 * `Cache-Control: no-cache, must-revalidate` on every page. Cloudflare is
 * already proxying the domain but `cf-cache-status: DYNAMIC` confirms it caches
 * nothing, so it provides zero protection.
 *
 * This installs the cache rules that make anonymous traffic free: Cloudflare
 * answers from its own edge and the request never reaches Netlify, so it costs
 * no compute, no request, and no bandwidth credits.
 *
 * ── THE FOUR SAFETY GUARDS (all four matter) ─────────────────────────────────
 *  1. AUTH BYPASS. Never cache a response for a request carrying the Supabase
 *     auth cookie. Several pages (/bills, /campaigns, /calendar) personalise
 *     server-side; caching those for everyone would serve one user's data to
 *     the world. Signed-in traffic always goes to origin.
 *  2. RSC BYPASS. Next.js sends `Vary: rsc, next-router-state-tree, ...`, but
 *     custom cache keys are not available on the Free plan, so Cloudflare would
 *     ignore that Vary and could hand an RSC flight payload to a document
 *     request (or the reverse), breaking client navigation. We therefore cache
 *     ONLY plain document GETs and let every RSC request through.
 *  3. PATH ALLOWLIST. Default is "do not cache". Only paths verified to render
 *     identically for every visitor are listed. A wrong entry here is a data
 *     leak, so the list is opt-in and short.
 *  4. EDGE TTL OVERRIDE. The origin says `no-cache`; respecting that would make
 *     the whole rule a no-op. We deliberately override origin TTL at the edge
 *     while sending browsers `max-age=0`, so users still revalidate and a purge
 *     takes effect immediately.
 *
 * Usage:
 *   node --env-file=.env.local scripts/cloudflare-cache-setup.mjs            # dry run
 *   node --env-file=.env.local scripts/cloudflare-cache-setup.mjs --apply
 *   node --env-file=.env.local scripts/cloudflare-cache-setup.mjs --purge
 *
 * Requires CLOUDFLARE_CACHE_TOKEN with Zone > Cache Rules > Edit AND
 * Zone > Cache Purge > Purge on the ikratom.org zone. The existing
 * CLOUDFLARE_DEPLOY_TOKEN is Zone:Read only and CANNOT do this.
 */

const APPLY = process.argv.includes("--apply");
const PURGE = process.argv.includes("--purge");

const ZONE = process.env.CLOUDFLARE_ZONE_ID || "6f054a2b237f9b7ec10d525ec7e99d05"; // ikratom.org
const TOKEN = process.env.CLOUDFLARE_CACHE_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

// Derived from NEXT_PUBLIC_SUPABASE_URL so an account/project move can't leave a
// stale cookie name here silently caching signed-in pages.
const SUPABASE_REF = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1];
const AUTH_COOKIE = SUPABASE_REF ? `sb-${SUPABASE_REF}-auth-token` : null;

/**
 * Paths that render identically for every visitor. KEEP THIS SHORT AND PROVEN.
 *
 * ⚠ EVERY ENTRY IS AUDITED. A wrong entry here is a privacy breach, not a bug.
 * It is not enough for the page file to look clean — a page is only cacheable if
 * NOTHING in its render tree reads the viewer. Three shared server components
 * silently poison otherwise-public pages, and a grep of page files alone gives
 * false "safe" verdicts:
 *   - PageShareWithAttribution → bakes the VIEWER'S OWN invite code into the HTML
 *   - SignUpNudge / EnablePushNudge → async server components reading auth
 *
 * REMOVED after audit (they looked safe and are NOT — do not re-add):
 *   /banned        → imports PageShareWithAttribution; caching it would serve
 *                    one user's personal referral code to every visitor.
 *   /meetings/:id  → imports SignUpNudge + EnablePushNudge. (The page's own
 *                    comment claiming "no viewer-specific reads" is wrong.)
 *
 * ⚠ PREFIX vs EXACT MATTERS:
 *   /states   is safe, /states/:code is NOT  → exact match only
 *   /news     is NOT safe, /news/:id IS      → "/news/" prefix (with the slash)
 *   /briefings is safe, /briefings/:slug NOT → exact match only
 *
 * Never here: / · /bills · /campaigns · /calendar · /legislators · /forum/* ·
 * /account/* · /admin/* · /api/* · /search · /research*
 */
export const CACHEABLE_PATTERNS = [
  // Viewer-independent DB reads (service-role + unstable_cache), high crawl value
  'starts_with(http.request.uri.path, "/news/")',
  'starts_with(http.request.uri.path, "/topics")',
  'starts_with(http.request.uri.path, "/whats-new")',
  'http.request.uri.path eq "/states"',
  'http.request.uri.path eq "/status"',
  'http.request.uri.path eq "/briefings"',
  'http.request.uri.path in {"/donate" "/ethics" "/support"}',
  // Fully static content pages (no data fetch at all)
  'starts_with(http.request.uri.path, "/install")',
  'http.request.uri.path in {"/glossary" "/membership" "/roles"}',
  'http.request.uri.path in {"/cookies" "/privacy" "/terms"}',
  'http.request.uri.path in {"/action" "/community" "/knowledge" "/legislative"}',
];

// Static build output is immutable and safe to cache hard, regardless of auth.
const STATIC_EXPR = 'starts_with(http.request.uri.path, "/_next/static/") or starts_with(http.request.uri.path, "/icons/")';

function cacheableExpression() {
  if (!AUTH_COOKIE) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing — refusing to build a rule without the auth-cookie bypass");
  return [
    '(http.request.method eq "GET")',
    `(not http.cookie contains "${AUTH_COOKIE}")`,       // guard 1
    '(not any(http.request.headers["rsc"][*] == "1"))',   // guard 2
    `(${CACHEABLE_PATTERNS.join(" or ")})`,               // guard 3
  ].join(" and ");
}

const rules = () => [
  {
    description: "ikratom: cache immutable build assets",
    expression: STATIC_EXPR,
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      edge_ttl: { mode: "override_origin", default: 31536000 },
      browser_ttl: { mode: "override_origin", default: 31536000 },
    },
  },
  {
    description: "ikratom: cache anonymous public HTML (bypass auth cookie + RSC)",
    expression: cacheableExpression(),
    action: "set_cache_settings",
    action_parameters: {
      cache: true,
      // guard 4 — origin says no-cache; override at the edge only.
      edge_ttl: { mode: "override_origin", default: 300 },
      browser_ttl: { mode: "override_origin", default: 0 },
    },
  },
];

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!json.success) {
    throw new Error(`${path} -> ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result;
}

if (!TOKEN) {
  console.error("✗ No CLOUDFLARE_CACHE_TOKEN (or CLOUDFLARE_API_TOKEN) in env.");
  console.error("  Create one at https://dash.cloudflare.com/profile/api-tokens");
  console.error("  Permissions: Zone > Cache Rules > Edit  +  Zone > Cache Purge > Purge");
  console.error("  Scope: Zone = ikratom.org");
  process.exit(1);
}

console.log("Zone:", ZONE);
console.log("Auth-cookie bypass:", AUTH_COOKIE ?? "(MISSING — would refuse)");
console.log("\nRules to install:\n");
for (const r of rules()) {
  console.log(`  • ${r.description}`);
  console.log(`    when: ${r.expression}`);
  console.log(`    edge_ttl=${r.action_parameters.edge_ttl.default}s browser_ttl=${r.action_parameters.browser_ttl.default}s\n`);
}

if (PURGE) {
  await cf(`/zones/${ZONE}/purge_cache`, { method: "POST", body: JSON.stringify({ purge_everything: true }) });
  console.log("✓ Cache purged.");
  process.exit(0);
}

if (!APPLY) {
  console.log("DRY RUN — nothing changed. Re-run with --apply to install.");
  process.exit(0);
}

// The cache-settings phase has a single zone entrypoint ruleset; PUT replaces
// its rules wholesale, which keeps this script idempotent (re-running installs
// exactly the rules above rather than appending duplicates).
const phase = "http_request_cache_settings";
let entrypoint;
try {
  entrypoint = await cf(`/zones/${ZONE}/rulesets/phases/${phase}/entrypoint`);
} catch {
  entrypoint = await cf(`/zones/${ZONE}/rulesets`, {
    method: "POST",
    body: JSON.stringify({ name: "ikratom cache rules", kind: "zone", phase, rules: [] }),
  });
}

const updated = await cf(`/zones/${ZONE}/rulesets/${entrypoint.id}`, {
  method: "PUT",
  body: JSON.stringify({ rules: rules() }),
});
console.log(`✓ Installed ${updated.rules?.length ?? 0} cache rules on ikratom.org.`);
console.log("  Verify with:  curl -sI https://www.ikratom.org/banned | grep -i cf-cache-status");
console.log("  Expect MISS on the first hit, then HIT.");

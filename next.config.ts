import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { buildCsp } from "./src/lib/csp";

// CSP scoped to our specific Supabase project at build time. The directive list
// is the single source of truth in src/lib/csp.ts, shared with proxy.ts so the
// enforced (here) and report-only (proxy) headers can never drift (pen-test SHC-03).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_HOST = (() => {
  try { return new URL(SUPABASE_URL).host; } catch { return ""; }
})();

// React's DEVELOPMENT runtime uses eval() for debugging (callstack
// reconstruction, hot-reload); a CSP without 'unsafe-eval' breaks `next dev`
// (and the Next dev-tools), throwing "eval() is not supported in this
// environment" on every page. PRODUCTION React never uses eval(), so prod keeps
// the tighter 'wasm-unsafe-eval' — enough for the in-browser Kokoro TTS WASM,
// but denies arbitrary eval()/new Function() (the XSS-containment win from #660).
const SCRIPT_EVAL = process.env.NODE_ENV === "production" ? "'wasm-unsafe-eval'" : "'unsafe-eval'";

const csp = buildCsp({ supabaseHost: SUPABASE_HOST, scriptEval: SCRIPT_EVAL });

const securityHeaders = [
  // Force HTTPS for 2 years once deployed (browsers ignore on http:// dev)
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Block clickjacking
  { key: "X-Frame-Options", value: "DENY" },
  // Stop MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs in Referer
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down browser features
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()" },
  // Block legacy Flash/Java cross-domain policy lookups
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  // Modern process isolation — Spectre-class defense in depth
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Limit who can embed our resources cross-origin
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Content Security Policy
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // Hide "X-Powered-By: Next.js"
  // Don't ship JS source maps to production browsers — keeps minified
  // bundle the only artifact a copycat sees. (Server-side stack-trace
  // decoding still works via the build's hidden source maps.)
  productionBrowserSourceMaps: false,
  // Tree-shake heavy barrel imports so only the used members ship. These are
  // the client-heavy packages in our graph (framer-motion on the landing page,
  // marked for markdown render, posthog-js analytics).
  experimental: {
    optimizePackageImports: ["framer-motion", "marked", "posthog-js"],
  },
  // Serve modern image formats when next/image is used (smaller than PNG/JPEG).
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      // Static security advertisements served at well-known paths
      {
        source: "/.well-known/security.txt",
        headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }],
      },
    ];
  },
  async redirects() {
    return [
      // The live efficiency breakdown lives in the /pitch suite (shares the
      // pitch layout + MermaidLoader). Support the shorter URL /efficiency that
      // gets shared around so it doesn't 404.
      { source: "/efficiency", destination: "/pitch/efficiency", permanent: false },
      // /briefings/state/:code — FOLDED into the State HQ (2026-06-22, see
      // private/STATE_HUB_SPEC.md). Preserves the launch-broadcast link and any
      // printed/shared links.
      //
      // This lives HERE, not as a page route, because of what happened when it
      // was one. As a force-dynamic page it paid for a server invocation on
      // every hit to compute a constant. Converting it to a static page was
      // WORSE: Next turns a server redirect() in a prerendered route into a
      // meta-refresh, so it answered HTTP 200 with a client-side hop instead of
      // a real redirect — an extra round trip for readers and a much weaker
      // signal for search engines than a 308. Verified live before reverting.
      //
      // A config redirect is a true 308 handled at the edge with no server cost
      // at all, which is strictly better than either page version.
      // permanent:false (307) deliberately, matching /efficiency above. A 308 is
      // cached by browsers indefinitely and the State-HQ IA is still actively
      // being rebuilt (private/STATE_HUB_SPEC.md); a redirect you cannot take
      // back is a bad trade for a marginal SEO gain.
      //
      // Case is safe to pass through unchanged: /states/[code] uppercases the
      // segment itself — verified live that /states/OK, /states/ok and
      // /states/Ok all return 200 — so dropping the old page's toUpperCase()
      // changes nothing. The destination is a same-origin relative path and
      // :code matches a single segment, so this cannot become an open redirect.
      { source: "/briefings/state/:code", destination: "/states/:code#briefing", permanent: false },
      // /events — FOLDED into the Community Calendar (owner decision
      // 2026-06-12; /calendar is a superset: town halls + hearings from
      // legislator_events, plus elections, bills, sessions, meetings).
      //
      // This was a force-dynamic page whose entire body was `redirect()`. It
      // reads zero Supabase rows, so it was never an egress cost — but it is
      // linked from MobileNav on every page, so every crawler followed it and
      // paid for a server invocation to compute a constant.
      //
      // Making it a STATIC page is not the fix — see the /briefings note above,
      // where that was tried and reverted: Next turns a server redirect() in a
      // prerendered route into a meta-refresh, answering HTTP 200 with a
      // client-side hop instead of a real redirect. The recipe's other escape
      // hatch (move the searchParams read into a client component) is worse
      // still here, because the ?state= passthrough IS the page — a client-side
      // redirect drops it for crawlers and no-JS readers entirely.
      //
      // A config redirect is a true edge-handled 307 with no server cost, and
      // it survives a Supabase restriction because nothing runs.
      //
      // ?state= carries through automatically: "any query values provided in
      // the request will be passed through to the redirect destination" and our
      // destination has no query string of its own, so /events?state=OK lands on
      // /calendar?state=OK.
      //
      // Dropping the old page's /^[A-Z]{2}$/ guard + toUpperCase() is safe on
      // both counts. /calendar does `sp.state?.toUpperCase()` itself, and it
      // filters by string equality — a junk code yields an empty list, never a
      // throw. It is also already reachable directly as /calendar?state=junk, so
      // this adds no input that was not already accepted. Source and destination
      // are both literal same-origin paths with no interpolation, so this cannot
      // become an open redirect.
      { source: "/events", destination: "/calendar", permanent: false },
    ];
  },
};

// Sentry wrapper: instruments builds for source-map upload + error
// reporting. Source-map upload only happens when SENTRY_AUTH_TOKEN is
// set — without it, errors still report but stack traces stay minified.
// Wrapping is idempotent if Sentry env vars are missing.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT || "ikratom",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Strip source-map files from production browser bundle. Maps are
  // uploaded to Sentry server-side for stack-trace decoding only.
  sourcemaps: { disable: false, deleteSourcemapsAfterUpload: true },
  // Skip Sentry plugin entirely if env unset
  disableLogger: true,
});

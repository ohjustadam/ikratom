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

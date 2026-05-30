import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Build a CSP scoped to our specific Supabase project at build time so the
// connect-src can't be abused by any other supabase.co subdomain.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_HOST = (() => {
  try { return new URL(SUPABASE_URL).host; } catch { return ""; }
})();
const SUPABASE_HTTPS = SUPABASE_HOST ? `https://${SUPABASE_HOST}` : "";
const SUPABASE_WSS = SUPABASE_HOST ? `wss://${SUPABASE_HOST}` : "";

const csp = [
  "default-src 'self'",
  // Tailwind/Next.js inline some bootstrap styles; scripts use 'unsafe-inline'
  // because Next 16's RSC payload requires inline script. Tightening to nonces
  // requires Next-side support; tracked as a future upgrade.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  // Allow our exact Supabase project (HTTPS for REST, WSS for Realtime). No
  // wildcard — limits exfiltration to one specific origin.
  // Allow Supabase + Vercel telemetry + Sentry ingest (subdomain wildcard
  // because Sentry uses *.ingest.sentry.io / *.ingest.us.sentry.io tied to
  // your project) + PostHog (us.i.posthog.com / us-assets.i.posthog.com).
  `connect-src 'self' ${SUPABASE_HTTPS} ${SUPABASE_WSS} https://vitals.vercel-insights.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://us.i.posthog.com https://us-assets.i.posthog.com`.trim(),
  // Audio/video: same-origin + our Supabase project (where rendered
  // daily-brief MP3s live) + blob: so any future fetch-to-blob fallback
  // continues to work. Missing this directive caused Chrome to block
  // every <audio> with "Media load rejected by URL safety check"
  // because CSP fell back to default-src 'self'.
  `media-src 'self' ${SUPABASE_HTTPS} blob:`.trim(),
  `script-src-elem 'self' 'unsafe-inline' https://us-assets.i.posthog.com`.trim(),
  // No <iframe> may embed our pages
  "frame-ancestors 'none'",
  // No <iframe> may be embedded by us either (admins can opt into specific
  // sources later via library embed_html, which is admin-only).
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "base-uri 'self'",
  "form-action 'self'",
  // Disable Adobe Flash etc. (legacy plugin types)
  "object-src 'none'",
  // Force any HTTP subresources to upgrade to HTTPS
  "upgrade-insecure-requests",
].filter(Boolean).join("; ");

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

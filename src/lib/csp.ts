/**
 * Single source of truth for the Content-Security-Policy (pen-test SHC-03).
 *
 * Previously the CSP lived in BOTH next.config.ts (enforced header) and proxy.ts
 * (report-only header) as two hand-maintained directive lists that had drifted —
 * a maintenance hazard, and a latent trap: with CSP_MODE=enforce, proxy.ts would
 * emit a SECOND, weaker enforced CSP header that browsers intersect with
 * next.config's, potentially breaking the site. Both now build from this one
 * function, so they can never diverge and the report-only header faithfully
 * mirrors what's enforced.
 *
 * The directive list is byte-identical to next.config.ts's prior enforced policy
 * — this consolidation does NOT change the enforced policy, only unifies its
 * source. scriptEval is env-gated by the caller ('wasm-unsafe-eval' in prod,
 * 'unsafe-eval' in dev for React's dev runtime).
 *
 * NOTE (SHC-01): script-src keeps 'unsafe-inline' because Next 16 does not apply
 * nonces to its RSC inline bootstrap scripts; a nonce-only policy would flag
 * every render. Tracked for when Next ships first-class nonce support. Prod uses
 * 'wasm-unsafe-eval' (NOT 'unsafe-eval'), so arbitrary eval()/new Function() is
 * still denied, and all user-rendered content is sanitized — so there is no
 * inline-script XSS sink despite 'unsafe-inline'.
 */
export function buildCsp(opts: { supabaseHost: string; scriptEval: string }): string {
  const { supabaseHost, scriptEval } = opts;
  const https = supabaseHost ? `https://${supabaseHost}` : "";
  const wss = supabaseHost ? `wss://${supabaseHost}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${scriptEval} https://va.vercel-scripts.com https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${https} ${wss} https://vitals.vercel-insights.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://us.i.posthog.com https://us-assets.i.posthog.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.aws.cdn.hf.co https://cdn.jsdelivr.net`.trim(),
    `media-src 'self' ${https} https: blob:`.trim(),
    `script-src-elem 'self' 'unsafe-inline' https://us-assets.i.posthog.com https://cdn.jsdelivr.net`.trim(),
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://w.soundcloud.com https://open.spotify.com https://embed.podcasts.apple.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

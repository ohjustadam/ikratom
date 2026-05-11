import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Refreshes the Supabase auth cookie on every request and gates protected routes.
 */

const protectedRoutes = ["/dashboard", "/account", "/admin", "/notifications", "/messages"];

const EMBED_REF_COOKIE = "embed_ref";
const EMBED_REF_TTL_DAYS = 60;
const LANDING_STATE_COOKIE = "landing_state";
const LANDING_STATE_TTL_DAYS = 7;
// Hostnames are restricted to lowercase letters, digits, dots, hyphens. This
// prevents an attacker from setting an arbitrary cookie value via a crafted
// URL (which would later land in the database).
const HOST_RE = /^[a-z0-9.-]{1,80}$/;
// State codes: 2 ASCII letters, or "FED" for federal.
const STATE_RE = /^([A-Z]{2}|FED)$/;

// Hard-block declared AI-training crawlers + abusive scrapers at the
// edge. Vercel WAF would be cleaner but it's a paid feature; this is the
// free substitute. Honor system + cheap to update — paste a UA into the
// list and it gets a 403 within seconds of redeploy.
const BLOCKED_UA_RE = /(GPTBot|ClaudeBot|Claude-Web|anthropic-ai|CCBot|Google-Extended|PerplexityBot|YouBot|Bytespider|Meta-ExternalAgent|Meta-ExternalFetcher|Diffbot|ImagesiftBot|DataForSeoBot|cohere-ai|ai2bot|Timpibot|MJ12bot|AhrefsBot|SemrushBot|DotBot|MegaIndex|PetalBot|BLEXBot|SeznamBot|SerendeputyBot)/i;

/**
 * Build the Content-Security-Policy header for a given nonce.
 *
 * Strategy:
 *   - script-src: 'self' + nonce + 'strict-dynamic' so scripts loaded
 *     by trusted (nonced) scripts also get trust. This is the modern
 *     approach Next.js recommends for App Router.
 *   - style-src: 'self' 'unsafe-inline' — Tailwind v4 emits inline
 *     styles in dev + Next.js inlines critical CSS. A style-nonce would
 *     be tighter but breaks Tailwind utilities. Style XSS is a much
 *     smaller surface than script XSS so this is an acceptable tradeoff.
 *   - connect-src: Supabase realtime + REST, Sentry, PostHog, Vercel
 *     analytics/speed-insights, our own R2 bucket public base.
 *   - img-src: 'self' data: blob: + R2 + Discord CDN + Vercel image
 *     optimization + Google news favicons.
 *   - frame-src: YouTube + Vimeo for library embeds (allow only the
 *     same domains the embed sanitizer in src/lib/embed-safety.ts
 *     accepts).
 *   - frame-ancestors: 'none' (we don't allow being embedded anywhere).
 *   - object-src: 'none' — defeats legacy plugin-based XSS.
 *   - base-uri / form-action: 'self' — locks down <base> and form
 *     submission targets.
 *   - upgrade-insecure-requests: forces any accidental http:// asset
 *     references over https.
 *
 * report-uri intentionally omitted in v1; add later when we have a
 * collector. Browser console violations are visible to us during
 * development.
 */
function buildCspHeader(nonce: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseHost = supabaseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const r2Base = process.env.R2_PUBLIC_BASE_URL ?? "";
  const r2Host = r2Base.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  // Supabase realtime is WSS to the same project host.
  const wsSupabase = supabaseHost ? `wss://${supabaseHost}` : "";
  const httpSupabase = supabaseHost ? `https://${supabaseHost}` : "";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // Vercel Analytics + Speed Insights load from these:
      "https://va.vercel-scripts.com",
      "https://vitals.vercel-insights.com",
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https:", // accept any https image source — user-supplied news thumbnails, partner avatars, etc.
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      httpSupabase,
      wsSupabase,
      r2Base || "",
      r2Host ? `https://${r2Host}` : "",
      // Sentry ingestion
      "https://*.ingest.sentry.io",
      "https://*.ingest.us.sentry.io",
      // PostHog
      "https://us.i.posthog.com",
      "https://app.posthog.com",
      // Vercel Analytics + Speed Insights
      "https://vitals.vercel-insights.com",
      "https://va.vercel-scripts.com",
    ].filter(Boolean),
    "frame-src": [
      "'self'",
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
      "https://player.vimeo.com",
    ],
    "media-src": ["'self'", "blob:", "https:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

/**
 * Apply our standard security-header set to any NextResponse. Called
 * on every return path (including redirects) so we get coverage even
 * on edge bounces.
 *
 * The nonce parameter, when provided, is also used for CSP. Redirect
 * responses (no HTML body) skip the CSP set since there's no script
 * context to govern.
 */
function withSecurityHeaders(res: NextResponse, nonce?: string): NextResponse {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "fullscreen=(self)",
    ].join(", ")
  );
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  if (nonce) {
    // CSP_MODE env toggle so we can flip enforcement without redeploy
    // pain. Defaults to report-only for the initial rollout so any
    // page we hadn't audited doesn't break — violations still log to
    // the browser console for us to see + fix. Switch to enforced
    // once we've watched a day of real traffic without violations.
    const cspMode = process.env.CSP_MODE === "enforce" ? "enforce" : "report-only";
    const headerName =
      cspMode === "enforce"
        ? "Content-Security-Policy"
        : "Content-Security-Policy-Report-Only";
    res.headers.set(headerName, buildCspHeader(nonce));
  }
  return res;
}

export async function proxy(request: NextRequest) {
  // ── Bot block at the edge — runs before any Supabase setup ───────
  // Don't bother with Supabase + cookies for crawlers we'd block anyway.
  const ua = request.headers.get("user-agent") ?? "";
  if (ua && BLOCKED_UA_RE.test(ua)) {
    return withSecurityHeaders(
      new NextResponse("Forbidden", {
        status: 403,
        headers: {
          "Content-Type": "text/plain",
          "X-Robots-Tag": "noindex, nofollow",
        },
      })
    );
  }

  // ── CSP nonce ────────────────────────────────────────────────────
  // Generate a per-request nonce that we pass to Next.js via the
  // `x-nonce` request header. The root layout reads it and applies
  // it to any inline <script>. Next.js's own RSC/streaming script
  // tags automatically pick up the nonce when the CSP header is set
  // here in the proxy. We also propagate the same nonce in the
  // response CSP header.
  //
  // Skip CSP entirely for /api routes — those return JSON, no script
  // context to govern, and the CSP header just adds bytes.
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const nonce = isApiRoute
    ? ""
    : Buffer.from(crypto.randomUUID()).toString("base64");

  // Augment incoming request headers with the nonce so the layout can
  // read it via `headers().get('x-nonce')`. Skip for API routes.
  const requestHeaders = new Headers(request.headers);
  if (nonce) {
    requestHeaders.set("x-nonce", nonce);
  }

  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ── Embed referral capture ──────────────────────────────────────
  // When a user lands via the embed widget, the URL contains
  //   ?ref=embed&host=<hostname>
  // We persist the host in an HTTPOnly cookie so subsequent campaign
  // actions can be credited back to the embedding site.
  const ref = request.nextUrl.searchParams.get("ref");
  const host = request.nextUrl.searchParams.get("host");
  const stateParam = request.nextUrl.searchParams.get("state");
  if (ref === "embed" && host && HOST_RE.test(host.toLowerCase())) {
    response.cookies.set(EMBED_REF_COOKIE, host.toLowerCase(), {
      maxAge: EMBED_REF_TTL_DAYS * 24 * 60 * 60,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  }
  // Capture state code from any URL (embed link OR direct share). Used by
  // signIn / signUp to auto-route the user to a matched campaign on first
  // landing, replacing the default /dashboard target.
  if (stateParam && STATE_RE.test(stateParam.toUpperCase())) {
    response.cookies.set(LANDING_STATE_COOKIE, stateParam.toUpperCase(), {
      maxAge: LANDING_STATE_TTL_DAYS * 24 * 60 * 60,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );

  if (isProtected && !user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (request.nextUrl.pathname === "/login" && user) {
    return withSecurityHeaders(
      NextResponse.redirect(new URL("/dashboard", request.url))
    );
  }

  // Account-locked gate (migration 0082) + force-password-change gate
  // (migration 0084). Both run on the same single profile read for
  // perf — admin-locked users go to /locked, admin-temp-passworded
  // users go to /account/security/force-change. Cheap single-column
  // read; non-fatal if it errors (don't block normal users on a DB
  // hiccup).
  if (
    user &&
    !request.nextUrl.pathname.startsWith("/locked") &&
    !request.nextUrl.pathname.startsWith("/account/security/force-change") &&
    !request.nextUrl.pathname.startsWith("/auth/") &&
    !request.nextUrl.pathname.startsWith("/api/") &&
    !request.nextUrl.pathname.startsWith("/_next")
  ) {
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("account_locked_at, password_must_change_at")
        .eq("id", user.id)
        .single();
      const p = prof as { account_locked_at?: string | null; password_must_change_at?: string | null } | null;
      if (p?.account_locked_at) {
        return withSecurityHeaders(
          NextResponse.redirect(new URL("/locked", request.url))
        );
      }
      if (p?.password_must_change_at) {
        return withSecurityHeaders(
          NextResponse.redirect(new URL("/account/security/force-change", request.url))
        );
      }
    } catch {
      // fail-open — don't lock users out on transient DB errors
    }
  }

  return withSecurityHeaders(response, nonce);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

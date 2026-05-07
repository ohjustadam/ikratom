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

export async function proxy(request: NextRequest) {
  // ── Bot block at the edge — runs before any Supabase setup ───────
  // Don't bother with Supabase + cookies for crawlers we'd block anyway.
  const ua = request.headers.get("user-agent") ?? "";
  if (ua && BLOCKED_UA_RE.test(ua)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "Content-Type": "text/plain",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  let response = NextResponse.next({ request });

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
    return NextResponse.redirect(loginUrl);
  }

  if (request.nextUrl.pathname === "/login" && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

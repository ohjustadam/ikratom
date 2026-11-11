/**
 * The chrome's two per-page server calls stay off for visitors they cannot
 * change anything for (2026-11-10 credit-burn cut).
 *
 *   - `/api/me` is skipped when there is no Supabase auth cookie: the server
 *     would answer the anonymous shape, so the browser builds it.
 *   - `/api/attribution` is skipped for a `?state=` filter link clicked on our
 *     own site; real landings (invites, embeds, outside links) still report.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasSupabaseAuthCookie, localeFromCookie } from "../src/lib/chrome-cookies";
import { attributionToCapture } from "../src/lib/attribution-landing";

const ORIGIN = "https://www.ikratom.org";

describe("hasSupabaseAuthCookie", () => {
  it("sees a session cookie, whole or chunked", () => {
    expect(hasSupabaseAuthCookie("sb-abcd1234-auth-token=base64-eyJhY2Nlc3M")).toBe(true);
    expect(hasSupabaseAuthCookie("theme=dark; sb-abcd1234-auth-token.0=base64-eyJ; sb-abcd1234-auth-token.1=xyz")).toBe(true);
    expect(hasSupabaseAuthCookie("locale=id;sb-abcd1234-auth-token=v")).toBe(true);
  });

  it("is false with no session cookie, or a cleared one", () => {
    expect(hasSupabaseAuthCookie("")).toBe(false);
    expect(hasSupabaseAuthCookie(null)).toBe(false);
    expect(hasSupabaseAuthCookie("locale=id; ph_phc_x_posthog=%7B%7D; embed_seen=1")).toBe(false);
    expect(hasSupabaseAuthCookie("sb-abcd1234-auth-token=; locale=en")).toBe(false);
  });

  it("does not mistake a lookalike name for the session", () => {
    expect(hasSupabaseAuthCookie("not-sb-abcd-auth-token-x=1")).toBe(false);
    expect(hasSupabaseAuthCookie("xsb-abcd-auth-token=1")).toBe(false);
  });

  it("matches the name supabase-js actually writes", () => {
    // `sb-${hostname.split(".")[0]}-auth-token` in @supabase/supabase-js.
    const ref = new URL("https://xyzcompany.supabase.co").hostname.split(".")[0];
    expect(hasSupabaseAuthCookie(`sb-${ref}-auth-token=base64-abc`)).toBe(true);
  });

  it("relies on @supabase/ssr leaving the auth cookie readable by page JS", () => {
    // If this default ever flips to httpOnly, document.cookie can no longer see
    // the session and every member would be treated as signed out.
    const constants = readFileSync(
      path.join(process.cwd(), "node_modules/@supabase/ssr/dist/main/utils/constants.js"),
      "utf8",
    );
    expect(constants).toMatch(/httpOnly:\s*false/);
    // And nothing in our server client overrides it.
    const server = readFileSync(path.join(process.cwd(), "src/lib/supabase/server.ts"), "utf8");
    expect(server).not.toMatch(/httpOnly/);
  });
});

describe("localeFromCookie", () => {
  it("returns a supported locale from the cookie, else English", () => {
    expect(localeFromCookie("theme=dark; locale=id")).toBe("id");
    expect(localeFromCookie("locale=vi")).toBe("vi");
    expect(localeFromCookie("locale=klingon")).toBe("en");
    expect(localeFromCookie("")).toBe("en");
    expect(localeFromCookie("xlocale=id")).toBe("en");
  });
});

describe("ChromeProvider wiring", () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/chrome/ChromeProvider.tsx"), "utf8");
  it("checks the cookie before it fetches /api/me", () => {
    const check = src.indexOf("hasSupabaseAuthCookie(cookie)");
    const fetchAt = src.indexOf('fetch("/api/me"');
    expect(check).toBeGreaterThan(0);
    expect(fetchAt).toBeGreaterThan(check);
  });
});

describe("attributionToCapture", () => {
  it("reports nothing when the URL carries nothing", () => {
    expect(attributionToCapture("", "", ORIGIN)).toBeNull();
    expect(attributionToCapture("?tab=local", "https://google.com/", ORIGIN)).toBeNull();
    expect(attributionToCapture("?ref=embed", "", ORIGIN)).toBeNull(); // embed needs a host
  });

  it("skips a ?state= filter link clicked on our own site", () => {
    expect(attributionToCapture("?state=OK", `${ORIGIN}/legislators/abc`, ORIGIN)).toBeNull();
    expect(attributionToCapture("?state=TX&place=Austin", `${ORIGIN}/legislators?state=TX`, ORIGIN)).toBeNull();
  });

  it("still reports ?state= arriving from anywhere else", () => {
    expect(attributionToCapture("?state=OK", "https://www.facebook.com/", ORIGIN)?.state).toBe("OK");
    expect(attributionToCapture("?state=OK", "", ORIGIN)?.state).toBe("OK"); // app / typed / noreferrer
    expect(attributionToCapture("?state=OK", "not a url", ORIGIN)?.state).toBe("OK");
    // A different host on our domain family is not "our own page".
    expect(attributionToCapture("?state=OK", "https://ikratom.netlify.app/x", ORIGIN)?.state).toBe("OK");
  });

  it("always reports invites and partner embeds, even from our own pages", () => {
    expect(attributionToCapture("?via=abcd1234", `${ORIGIN}/how-it-works`, ORIGIN)).toEqual({ ref: null, host: null, state: null, via: "abcd1234" });
    const embed = attributionToCapture("?ref=embed&host=green-leaf-okc&state=FED", `${ORIGIN}/`, ORIGIN);
    expect(embed).toEqual({ ref: "embed", host: "green-leaf-okc", state: "FED", via: null });
  });

  it("AttributionCapture uses this rule", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/chrome/AttributionCapture.tsx"), "utf8");
    expect(src).toContain("attributionToCapture(window.location.search, document.referrer, window.location.origin)");
  });
});

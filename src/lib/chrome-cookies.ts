import { isValidLocale, type Locale } from "@/i18n/messages";

/**
 * Pure checks on `document.cookie` that let the site chrome skip a server call.
 *
 * WHY (2026-11-10): `ChromeProvider` fetched `/api/me` on every full page load,
 * and every fetch woke the paid server function, ~1 s at the origin. Over
 * 11-06..11-09 that was 580-1,080 calls a day, 8-20% of all origin time, and
 * almost all of it answered "signed out" to visitors who had no session
 * cookie at all (bots that run page JS, and first-time readers).
 *
 * The server decides "signed in" from the Supabase auth cookie and nothing
 * else (`getCachedAuthProfile` → `getClaims`). @supabase/ssr writes that cookie
 * with `httpOnly: false` (its DEFAULT_COOKIE_OPTIONS), because the browser
 * client has to read it, so page JS sees exactly what the server would see.
 * No cookie here means the route would answer the anonymous shape, so the
 * browser can build that shape itself. A cookie of any kind still calls the
 * server, so signed-in behaviour is unchanged.
 */

/**
 * `sb-<project-ref>-auth-token`, or one of its chunks (`.0`, `.1`, …) when the
 * session is larger than one cookie. Needs a non-empty value: a cleared cookie
 * is `name=` and means signed out. Errs toward true: a false positive only
 * costs the fetch every page load paid before.
 */
const SUPABASE_AUTH_COOKIE = /(?:^|;\s*)sb-[^=;\s]+-auth-token(?:\.\d+)?=[^;\s]/;

export function hasSupabaseAuthCookie(cookie: string | null | undefined): boolean {
  return typeof cookie === "string" && SUPABASE_AUTH_COOKIE.test(cookie);
}

/**
 * The `locale` cookie set by `setLocale()` (not httpOnly), if it names a
 * supported language. This is the same answer `/api/me` gives an anonymous
 * visitor: its `readLocale()` checks the cookie, then a profile they don't have.
 */
export function localeFromCookie(cookie: string | null | undefined): Locale {
  const m = typeof cookie === "string" ? cookie.match(/(?:^|;\s*)locale=([^;\s]*)/) : null;
  const value = m?.[1] ?? null;
  return isValidLocale(value) ? value : "en";
}

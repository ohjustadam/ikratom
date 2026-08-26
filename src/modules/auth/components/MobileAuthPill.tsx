"use client";

import { useChrome } from "@/components/chrome/ChromeProvider";

/**
 * Always-visible auth pill in the mobile header. When signed out:
 * "Sign in" button. When signed in: "Dashboard" button. Sits next to
 * the hamburger so users can reach the most-common destination in one
 * tap without ever opening the drawer.
 *
 * Client component (2026-07-22) — was a server component reading
 * `getCachedClaims()`, which is a cookie read in the ROOT layout and therefore
 * forced every route in the app to render dynamically. See
 * `private/STATIC_CHROME_PLAN.md`.
 */
export function MobileAuthPill() {
  const { me, loading } = useChrome();

  // Reserve the pill's footprint so the mobile header doesn't reflow when
  // /api/me lands.
  if (loading) {
    return (
      <span
        aria-hidden
        className="inline-block h-10 w-[86px] rounded-md bg-zinc-900/60 lg:hidden"
      />
    );
  }

  if (!me?.userId) {
    return (
      <a
        href="/login"
        className="inline-flex h-10 items-center rounded-md bg-emerald-500 px-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 lg:hidden"
      >
        Sign in
      </a>
    );
  }

  return (
    <a
      href="/dashboard"
      className="inline-flex h-10 items-center rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 text-sm font-semibold text-emerald-300 hover:border-emerald-500 lg:hidden"
    >
      Dashboard
    </a>
  );
}

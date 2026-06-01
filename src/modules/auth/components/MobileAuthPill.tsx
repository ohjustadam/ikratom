import { getCachedClaims } from "@/lib/supabase/server";

/**
 * Always-visible auth pill in the mobile header. When signed out:
 * "Sign in" button. When signed in: "Dashboard" button. Sits next to
 * the hamburger so users can reach the most-common destination in one
 * tap without ever opening the drawer.
 *
 * Server component — presence check via the request-cached claims
 * (local JWT verify, no auth round-trip; shared with layout + HeaderAuth).
 */
export async function MobileAuthPill() {
  const claims = await getCachedClaims();

  if (!claims) {
    return (
      <a
        href="/login"
        className="inline-flex h-10 items-center rounded-md bg-emerald-500 px-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 md:hidden"
      >
        Sign in
      </a>
    );
  }

  return (
    <a
      href="/dashboard"
      className="inline-flex h-10 items-center rounded-md border border-emerald-700/50 bg-emerald-950/30 px-3 text-sm font-semibold text-emerald-300 hover:border-emerald-500 md:hidden"
    >
      Dashboard
    </a>
  );
}

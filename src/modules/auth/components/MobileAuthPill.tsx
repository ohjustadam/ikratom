import { getCachedUser } from "@/lib/supabase/server";

/**
 * Always-visible auth pill in the mobile header. When signed out:
 * "Sign in" button. When signed in: "Dashboard" button. Sits next to
 * the hamburger so users can reach the most-common destination in one
 * tap without ever opening the drawer.
 *
 * Server component — uses the request-cached user (shares the single
 * auth round-trip with the layout + HeaderAuth).
 */
export async function MobileAuthPill() {
  const user = await getCachedUser();

  if (!user) {
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

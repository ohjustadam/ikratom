import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-LESS anonymous Supabase client for server routes whose response is
 * public and shared by every viewer.
 *
 * WHY THIS EXISTS (2026-08-20): `/calendar/feed.ics` used the cookie-bound
 * `@/lib/supabase/server` client while sending
 * `Cache-Control: public, s-maxage=600, stale-while-revalidate=1800`.
 * Those two things are incompatible. RLS widens for privileged viewers, so an
 * admin (or any signed-in user with broader policy access) requesting the feed
 * produced a LARGER row set — and that response was then cached publicly and
 * served to everyone for the next 10 minutes. A shared cache in front of a
 * per-viewer query is a cross-user disclosure, not a performance tweak.
 *
 * Using this client makes the response viewer-INDEPENDENT by construction:
 * no cookies are read, so RLS always evaluates as an anonymous visitor, so the
 * cached payload is exactly what a logged-out person may see. That restores the
 * invariant the `public` cache header depends on — and it is also cheaper,
 * because the route no longer opts into dynamic rendering by touching cookies.
 *
 * Use this ONLY for responses that are identical for every viewer. If a route
 * needs the current user, it must use `@/lib/supabase/server` AND must not send
 * a `public` cache header. This deliberately does NOT bypass RLS — it is the
 * anon key, not the service role (see `./service-role`).
 */
export function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

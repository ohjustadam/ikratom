import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components can't set cookies — proxy refreshes session.
          }
        },
      },
    }
  );
}

/**
 * Request-scoped cached `auth.getUser()`.
 *
 * PERF (V2_KICKOFF §3.A root cause): `supabase.auth.getUser()` makes a
 * network round-trip to the Supabase Auth server to revalidate the JWT
 * on EVERY call — it is not a local cookie decode. The app calls it 168×
 * across 122 files; in a single authenticated render the root layout +
 * HeaderAuth + MobileAuthPill + the page body each call it, stacking
 * ~4+ sequential auth round-trips (~0.5–1s) before any data loads.
 *
 * React `cache()` memoizes per-request (one RSC render pass), so all
 * callers in the same render share ONE auth round-trip. Security is
 * unchanged — the JWT is still server-validated, just once instead of
 * N times. Server actions are separate request invocations and get
 * their own (correct) single call.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Request-scoped cached `auth.getClaims()` — LOCAL JWT verification.
 *
 * The project uses asymmetric JWT signing keys (ES256 — confirmed via
 * the `/auth/v1/.well-known/jwks.json` endpoint), so getClaims() verifies
 * the access-token signature locally against the cached JWKS with NO
 * per-call network round-trip — unlike getUser(), which always round-
 * trips to the Auth server. Returns the JWT claims (`claims.sub` = user
 * id, `claims.email`, `claims.role`, …) or null when signed out.
 *
 * TRADEOFF (why this is the chrome helper, not the universal one):
 * claims are trusted until the token expires (~1h). A session revoked or
 * banned server-side keeps verifying until its access token refreshes.
 * That's fine for always-rendered chrome (presence + id → profile-role
 * lookup). For flows where IMMEDIATE revocation matters — admin
 * mutations, account/security pages — use getCachedUser()/getUser(),
 * which revalidate against the Auth server live.
 */
export const getCachedClaims = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});

export type CachedAuthProfile = {
  id: string;
  is_admin: boolean | null;
  is_owner: boolean | null;
  is_advocate_leader: boolean | null;
  leader_tour_pending: boolean | null;
  leader_acknowledged_at: string | null;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  ui_theme: string | null;
  ui_accent: string | null;
  ui_accent_hex: string | null;
  ui_mode: string | null;
};

/**
 * Request-scoped cached user-id + the profile columns the always-rendered
 * chrome (root layout, HeaderAuth) needs. Uses getCachedClaims (LOCAL
 * JWT verify, no auth round-trip) for the id, then dedupes the `profiles`
 * row read across layout + header into one DB trip. Returns nulls when
 * signed out.
 *
 * Returns `userId` (from the verified JWT) rather than the full Supabase
 * `User` object — the chrome only needs the id + profile roles, and
 * skipping getUser() is the whole point. Callers that need the full,
 * live-revalidated user object should use getCachedUser()/getUser().
 */
export const getCachedAuthProfile = cache(
  async (): Promise<{ userId: string | null; profile: CachedAuthProfile | null }> => {
    const claims = await getCachedClaims();
    const userId = typeof claims?.sub === "string" ? claims.sub : null;
    if (!userId) return { userId: null, profile: null };
    const supabase = await createClient();
    const CORE =
      "id, is_admin, is_owner, is_advocate_leader, leader_tour_pending, leader_acknowledged_at, username, full_name, avatar_url";
    // Try the extended select (incl. UI prefs). If migration 0172 hasn't
    // been applied yet, selecting the ui_* columns errors and returns null —
    // fall back to the CORE columns so the always-rendered chrome (admin /
    // leader checks) never breaks in the deploy-before-db:push window.
    const { data: extended } = await supabase
      .from("profiles")
      .select(`${CORE}, ui_theme, ui_accent, ui_accent_hex, ui_mode`)
      .eq("id", userId)
      .single();
    if (extended) return { userId, profile: extended as CachedAuthProfile };
    const { data: core } = await supabase
      .from("profiles")
      .select(CORE)
      .eq("id", userId)
      .single();
    return { userId, profile: (core as CachedAuthProfile | null) ?? null };
  },
);

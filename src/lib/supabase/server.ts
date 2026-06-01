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
};

/**
 * Request-scoped cached user + the profile columns the always-rendered
 * chrome (root layout, HeaderAuth) needs. Reuses getCachedUser so the
 * auth round-trip is shared, and dedupes the `profiles` row read across
 * layout + header into one DB trip. Returns nulls when signed out.
 */
export const getCachedAuthProfile = cache(
  async (): Promise<{ user: Awaited<ReturnType<typeof getCachedUser>>; profile: CachedAuthProfile | null }> => {
    const user = await getCachedUser();
    if (!user) return { user: null, profile: null };
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "id, is_admin, is_owner, is_advocate_leader, leader_tour_pending, leader_acknowledged_at, username, full_name, avatar_url",
      )
      .eq("id", user.id)
      .single();
    return { user, profile: (profile as CachedAuthProfile | null) ?? null };
  },
);

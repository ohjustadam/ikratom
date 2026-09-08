import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * /api/states/[code]/my-reps — the per-viewer half of the State HQ.
 *
 * WHY THIS EXISTS (2026-09-08). The State HQ page already snapshots everything
 * public through a cookieless service-role read inside unstable_cache, but it
 * still rendered "Your local reps" on the server, which meant a cookie read and
 * therefore a fully dynamic route — 51 crawlable pages re-querying Supabase on
 * every bot hit.
 *
 * That content CANNOT simply be baked into the cached page: it is one specific
 * visitor's own representatives, derived from the address on their profile.
 * Caching it would serve one person's district data to everyone. So it moves
 * here, onto the request-bound path, and the page becomes a static file.
 *
 * This route MUST stay dynamic and MUST NOT be cached — it is the one place
 * per-viewer work belongs. Same contract as /api/me.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type MyRep = {
  id: string;
  full_name: string;
  role: string;
  district: string | null;
  party: string | null;
  email: string | null;
  phone: string | null;
  portrait_url: string | null;
  website: string | null;
};

/**
 * A discriminated union rather than a nullable list, because the empty states
 * are the point: each one is a different activation step (sign up → complete
 * profile → go to your own state → request a sync), never a dead end.
 */
export type MyRepsResult =
  | { kind: "anon" }
  | { kind: "no-state" }
  | { kind: "other-state"; profState: string }
  | { kind: "no-match" }
  | { kind: "reps"; reps: MyRep[] };

const json = (body: MyRepsResult) =>
  NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const state = String(code || "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return json({ kind: "anon" });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ kind: "anon" });

    const { data: prof } = await supabase
      .from("profiles")
      .select("state, state_senate_district, state_house_district, congressional_district")
      .eq("id", user.id)
      .single();

    if (!prof?.state) return json({ kind: "no-state" });
    if (prof.state !== state) return json({ kind: "other-state", profState: prof.state });

    const districts = [prof.state_senate_district, prof.state_house_district, prof.congressional_district]
      .filter(Boolean);
    if (districts.length === 0) return json({ kind: "no-match" });

    const { data: reps } = await supabase
      .from("legislators")
      .select("id, full_name, role, district, party, email, phone, portrait_url, website")
      .eq("state", state)
      .eq("active", true)
      .in("role", ["state_senate", "state_house", "us_senate", "us_house"])
      .or(districts.map((d) => `district.eq.${d}`).join(","))
      .limit(12);

    if (!reps || reps.length === 0) return json({ kind: "no-match" });
    return json({ kind: "reps", reps: reps as MyRep[] });
  } catch {
    // Fail as anonymous rather than 500 — a broken reps read must never take
    // down the State HQ page it renders on.
    return json({ kind: "anon" });
  }
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { committeesMatch } from "@/lib/bill-committee";

/**
 * /api/bills/my-committees — "bills your reps are deciding".
 *
 * WHY THIS EXISTS (2026-09-08). This narrow used to be computed inside the
 * /bills page render, which meant the route read cookies, resolved the
 * viewer's representatives and their committee assignments — on EVERY request,
 * including the overwhelming majority that are crawlers who will never be
 * signed in. That single feature is what kept the whole bill tracker dynamic.
 *
 * It cannot be cached: it is one specific viewer's representatives, derived
 * from the address on their profile. So it moves here, onto the request-bound
 * path, and /bills becomes a static file.
 *
 * Returns bill IDs rather than bill rows. The page already ships the full
 * snapshot to the browser, so sending ids is a few KB instead of a second copy
 * of the payload — and this endpoint is the one part that runs per request.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type MyCommitteesResult =
  | { ok: true; billIds: string[] }
  | { ok: false; reason: string };

const json = (body: MyCommitteesResult) =>
  NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ ok: false, reason: "sign-in required" });

    const { data: prof } = await supabase
      .from("profiles")
      .select("state, congressional_district, state_senate_district, state_house_district, city, county")
      .eq("id", user.id)
      .single();

    const userState = (prof as { state?: string | null } | null)?.state ?? null;
    if (!userState) return json({ ok: false, reason: "your profile needs a state" });

    const reps = prof
      ? await getUserLegislators(supabase, prof as Parameters<typeof getUserLegislators>[1])
      : [];
    if (reps.length === 0) {
      return json({ ok: false, reason: "no representatives matched your address" });
    }

    const { data: assignments } = await supabase
      .from("legislator_committees")
      .select("committee_name")
      .in("legislator_id", reps.map((r) => r.id));
    const myCommitteeNames = (assignments ?? [])
      .map((a) => (a as { committee_name: string }).committee_name)
      .filter(Boolean);
    if (myCommitteeNames.length === 0) {
      return json({ ok: false, reason: "your reps have no committee assignments on file" });
    }

    // Only the viewer's own state can match, so scope the scan there rather
    // than pulling committee names for all ~1,500 tracked bills.
    const { data: ccRows } = await supabase
      .from("bills")
      .select("id, current_committee_name")
      .eq("state", userState)
      .not("current_committee_name", "is", null);

    const billIds = (ccRows ?? [])
      .filter((r) => {
        const cc = (r as { current_committee_name?: string | null }).current_committee_name;
        return !!cc && myCommitteeNames.some((mc) => committeesMatch(cc, mc));
      })
      .map((r) => (r as { id: string }).id);

    return json({ ok: true, billIds });
  } catch {
    // Degrade to "filter unavailable" rather than 500 — the bill tracker must
    // still render if this narrow fails.
    return json({ ok: false, reason: "filter temporarily unavailable" });
  }
}

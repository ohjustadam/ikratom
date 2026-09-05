import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getLegislatorIntel } from "@/lib/legislator-intel";

/**
 * /api/legislators/[id]/member — the member-only half of a legislator page.
 *
 * WHY THIS EXISTS (2026-09-04 compute fix): `/legislators/[id]` is 1,001 of the
 * 1,432 sitemap URLs and used to render per-viewer, because it called
 * `auth.getUser()` to decide whether to show the pressure index and the
 * per-bill voting record. One cookie read makes the whole route dynamic, so
 * every crawler hit booted a function and ran ~11 database queries. Compute was
 * 54% of the credit spend that took the site down on 2026-09-02.
 *
 * The page is now statically generated from the ANONYMOUS view of the data.
 * This route serves the extra that signed-in members get. Crawlers don't
 * execute JavaScript, so they never call it: compute scales with members, not
 * bots. Same inversion as `/api/me` — see `private/STATIC_CHROME_PLAN.md`.
 *
 * SECURITY: this uses the cookie-bound client on purpose, so Postgres RLS
 * decides what the caller may see. `legislator_stance` is readable only by
 * verified users and campaign creators (migration 0221), so the pressure index
 * this returns is already tier-correct without any check in here. Never swap
 * this for the service-role client and never cache this response — it is
 * per-viewer by definition.
 *
 * Returns 200 with `signedIn: false` for anonymous callers rather than 401:
 * the client renders the sign-up teaser in that case, and a 401 would just be
 * console noise on every logged-out page view.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MemberIntelPayload = {
  signedIn: boolean;
  pressureIndex: number | null;
  votes: Array<{
    voteId: string;
    chamber: string | null;
    motion: string | null;
    passed: boolean | null;
    vote_date: string | null;
    vote_value: number | null;
    vote_text: string | null;
    bill: { id: string; state: string; bill_number: string; title: string | null; kratom_relevance: string | null };
  }>;
};

const ANON: MemberIntelPayload = { signedIn: false, pressureIndex: null, votes: [] };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json(ANON, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(ANON);

  const { data: legRaw } = await supabase
    .from("legislators")
    .select("id, state, role, district, full_name, party, level, locality, body, title, active")
    .eq("id", id)
    .single();
  if (!legRaw) return NextResponse.json(ANON, { status: 404 });

  // Both reads run as the CALLER, so RLS gives them exactly their tier's view.
  const [intel, { data: voteRowsRaw }] = await Promise.all([
    getLegislatorIntel(supabase, legRaw as never),
    supabase
      .from("bill_vote_members")
      .select("vote_text, vote_value, bill_votes!inner(id, vote_date, chamber, motion, passed, bills!inner(id, state, bill_number, title, kratom_relevance))")
      .eq("legislator_id", id)
      .limit(500),
  ]);

  type VBill = MemberIntelPayload["votes"][number]["bill"];
  type RawBV = { id: string; vote_date: string | null; chamber: string | null; motion: string | null; passed: boolean | null; bills: VBill[] | VBill | null };
  type RawVoteRow = { vote_text: string | null; vote_value: number | null; bill_votes: RawBV[] | RawBV | null };

  const votes: MemberIntelPayload["votes"] = [];
  for (const r of ((voteRowsRaw ?? []) as unknown as RawVoteRow[])) {
    const bv = Array.isArray(r.bill_votes) ? r.bill_votes[0] : r.bill_votes;
    if (!bv) continue;
    const b = Array.isArray(bv.bills) ? bv.bills[0] : bv.bills;
    if (!b) continue;
    votes.push({
      voteId: bv.id, chamber: bv.chamber, motion: bv.motion, passed: bv.passed,
      vote_date: bv.vote_date, vote_value: r.vote_value, vote_text: r.vote_text, bill: b,
    });
  }
  votes.sort((a, z) => (z.vote_date ?? "").localeCompare(a.vote_date ?? ""));

  return NextResponse.json({
    signedIn: true,
    pressureIndex: intel?.verdict?.pressureIndex ?? null,
    votes,
  } satisfies MemberIntelPayload, {
    // Per-viewer. Must never sit in a shared cache.
    headers: { "Cache-Control": "private, no-store" },
  });
}

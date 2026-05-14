import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { committeesMatch } from "@/lib/bill-committee";

/**
 * My committee bills — dashboard widget compounding the
 * YourRepDecidingThisBill callout on /bills/[id].
 *
 * Surfaces every active bill in the user's state that's currently in
 * a committee one of their reps sits on. These are the bills where
 * the user has structural leverage RIGHT NOW — their call to that
 * specific rep moves the actual decision-makers.
 *
 * Renders nothing (returns null) when:
 *   - profile has no state
 *   - user has no reps fetched
 *   - migration 0123 hasn't been applied (current_committee_name column
 *     missing → the bills select errors out, caught + treated as empty)
 *   - no matching bills found
 *
 * The "renders nothing" path keeps the dashboard quiet for users who
 * have no leverage moments today, instead of showing an empty state
 * that would just be visual noise.
 */
export async function MyCommitteeBillsWidget({ userId }: { userId: string }) {
  const sb = await createClient();

  const { data: profile } = await sb
    .from("profiles")
    .select("state, congressional_district, state_senate_district, state_house_district, city, county")
    .eq("id", userId)
    .single();
  if (!profile?.state) return null;

  const reps = await getUserLegislators(sb, profile);
  if (reps.length === 0) return null;

  // Pull all committee assignments for the user's reps once.
  const repIds = reps.map((r) => r.id);
  const { data: assignments } = await sb
    .from("legislator_committees")
    .select("legislator_id, committee_name, role")
    .in("legislator_id", repIds);
  if (!assignments || assignments.length === 0) return null;

  // Pull bills in the user's state that have a current_committee_name
  // populated. Wrapped in try/catch so that pre-migration deployments
  // return an empty set rather than crashing the dashboard.
  type BillRow = {
    id: string;
    bill_number: string;
    title: string | null;
    status: string | null;
    current_committee_name: string | null;
    kratom_relevance: string | null;
    last_action_at: string | null;
  };
  let bills: BillRow[] = [];
  try {
    const { data, error } = await sb
      .from("bills")
      .select(
        "id, bill_number, title, status, current_committee_name, kratom_relevance, last_action_at",
      )
      .eq("state", profile.state)
      .eq("active", true)
      .not("current_committee_name", "is", null)
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(40);
    if (!error) bills = (data ?? []) as BillRow[];
  } catch {
    // Column doesn't exist yet → silent no-op
  }

  if (bills.length === 0) return null;

  // Cross-reference: for each bill, find which of the user's reps
  // sits on the bill's current_committee_name (loose match).
  type Match = {
    bill: BillRow;
    matchedReps: Array<{ id: string; full_name: string; role: string; committee: string }>;
  };
  const matches: Match[] = [];
  for (const bill of bills) {
    if (!bill.current_committee_name) continue;
    const matchedReps: Match["matchedReps"] = [];
    for (const a of assignments) {
      if (!committeesMatch(bill.current_committee_name, a.committee_name)) continue;
      const rep = reps.find((r) => r.id === a.legislator_id);
      if (!rep) continue;
      if (matchedReps.some((m) => m.id === rep.id)) continue;
      matchedReps.push({
        id: rep.id,
        full_name: rep.full_name,
        role: a.role,
        committee: a.committee_name,
      });
    }
    if (matchedReps.length > 0) matches.push({ bill, matchedReps });
  }

  if (matches.length === 0) return null;

  // Surface the top 5; chair-bearing rows first.
  const ROLE_RANK: Record<string, number> = {
    chair: 0,
    vice_chair: 1,
    ranking_member: 2,
    member: 9,
  };
  matches.sort((a, b) => {
    const ra = Math.min(...a.matchedReps.map((m) => ROLE_RANK[m.role] ?? 9));
    const rb = Math.min(...b.matchedReps.map((m) => ROLE_RANK[m.role] ?? 9));
    if (ra !== rb) return ra - rb;
    // Within same rank, anti-kratom bills first
    if (a.bill.kratom_relevance === "anti" && b.bill.kratom_relevance !== "anti") return -1;
    if (b.bill.kratom_relevance === "anti" && a.bill.kratom_relevance !== "anti") return 1;
    return 0;
  });

  const top = matches.slice(0, 5);
  const overflow = matches.length - top.length;

  return (
    <section className="rounded-lg border-2 border-emerald-500/60 bg-emerald-950/15 p-5 shadow-[0_0_24px_-12px_rgba(16,185,129,0.5)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950">
          ⚡ Leverage
        </span>
        <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-300">
          Bills your reps are deciding
        </h3>
        <span className="ml-auto text-xs text-zinc-500">
          {matches.length} active
        </span>
      </div>
      <p className="text-[11px] text-zinc-400">
        Each of these sits in a committee one of your representatives sits on. Lobbyists are targeting them right now. Your call counts more on these than on anything else.
      </p>
      <ul className="mt-3 space-y-2">
        {top.map(({ bill, matchedReps }) => {
          const isAnti = bill.kratom_relevance === "anti";
          const isPro = bill.kratom_relevance === "pro";
          const topRep = matchedReps.sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9))[0];
          const roleLabel =
            topRep.role === "chair" ? "Chair" :
            topRep.role === "vice_chair" ? "Vice chair" :
            topRep.role === "ranking_member" ? "Ranking member" :
            "Member";
          return (
            <li key={bill.id}>
              <Link
                href={`/bills/${bill.id}`}
                className="block rounded-md border border-emerald-700/40 bg-emerald-950/10 p-2.5 transition hover:border-emerald-500 hover:bg-emerald-950/25"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
                  <span className="font-mono font-semibold text-zinc-200">
                    {profile.state} · {bill.bill_number}
                  </span>
                  {isAnti && (
                    <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300">
                      Anti
                    </span>
                  )}
                  {isPro && (
                    <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
                      Pro
                    </span>
                  )}
                  <span className="text-zinc-500">·</span>
                  <span className="text-zinc-400">{bill.current_committee_name}</span>
                </div>
                <p className="mt-1 text-xs leading-snug text-zinc-100">
                  {bill.title?.slice(0, 110) ?? "(untitled)"}{bill.title && bill.title.length > 110 ? "…" : ""}
                </p>
                <p className="mt-1 text-[11px] text-emerald-300">
                  Your {topRep.role === "chair" ? "chair-seat rep" : "rep"}: <span className="font-semibold">{topRep.full_name}</span>
                  <span className="ml-1 text-zinc-500">· {roleLabel}</span>
                  {matchedReps.length > 1 && (
                    <span className="ml-1 text-zinc-500">+{matchedReps.length - 1} more</span>
                  )}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {overflow > 0 && (
        <p className="mt-3 text-[11px] text-zinc-500">
          + {overflow} more — see <Link href="/bills" className="text-emerald-400 hover:underline">all bills</Link>
        </p>
      )}
    </section>
  );
}

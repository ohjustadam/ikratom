import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Voting record visualizer — every kratom roll call",
  description:
    "Every recorded roll call on a kratom bill, with side-by-side legislator comparison when filtered by state. Stance is a guess; a vote is a fact.",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

type SP = Promise<{ state?: string }>;

/**
 * /intel/votes — voting record visualizer.
 *
 * Two views in one page:
 *
 *   1. INDEX (no filter): every kratom roll call we have, sorted by
 *      date desc. Grouped by state.
 *
 *   2. STATE GRID (?state=XX): side-by-side comparison — legislators
 *      in that state as columns, roll calls as rows, each cell a
 *      Yea/Nay/Other icon. Reveals voting patterns at a glance:
 *      who consistently voted YES on restrictive bills, who flipped,
 *      who abstained.
 *
 * Data: bill_votes (roll calls) + bill_vote_members (per-leg vote).
 * Legislator name resolution is partial — currently ~18% of vote
 * members are matched to a legislators row (the rest are state-leg
 * name strings that didn't fuzz-match). Grid hides unmatched rows so
 * the comparison stays clean; matching backfill is a separate task.
 */
export default async function VotesIntelPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const stateFilter = sp.state?.toUpperCase().trim();
  const sb = await createClient();

  // Pull all kratom-relevant roll calls + their bills.
  const { data: rollsRaw } = await sb
    .from("bill_votes")
    .select(
      "id, bill_id, vote_date, chamber, motion, passed, yea_count, nay_count, " +
      "bills!inner(id, state, bill_number, title, kratom_relevance, active)",
    )
    .order("vote_date", { ascending: false });

  type BillJ = { id: string; state: string; bill_number: string; title: string | null; kratom_relevance: string | null; active: boolean };
  type RollRow = {
    id: string; bill_id: string; vote_date: string | null;
    chamber: string | null; motion: string | null;
    passed: boolean | null; yea_count: number | null; nay_count: number | null;
    bills: BillJ | BillJ[] | null;
  };
  const norm = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
  type Roll = Omit<RollRow, "bills"> & { bill: BillJ };
  const rolls: Roll[] = [];
  for (const r of (rollsRaw ?? []) as unknown as RollRow[]) {
    const b = norm(r.bills);
    if (!b) continue;
    rolls.push({ ...r, bill: b });
  }

  // Optional state filter
  const stateRolls = stateFilter
    ? rolls.filter((r) => r.bill.state === stateFilter)
    : rolls;

  // For grid mode: pull all vote_members for the filtered rolls so we
  // can render the leg × roll matrix.
  type VoteMember = {
    bill_vote_id: string;
    legislator_id: string | null;
    vote_text: string | null;
    vote_value: number | null;
  };
  let voteMembers: VoteMember[] = [];
  if (stateFilter && stateRolls.length > 0) {
    const rollIds = stateRolls.map((r) => r.id);
    const { data } = await sb
      .from("bill_vote_members")
      .select("bill_vote_id, legislator_id, vote_text, vote_value")
      .in("bill_vote_id", rollIds)
      .not("legislator_id", "is", null);
    voteMembers = (data ?? []) as VoteMember[];
  }

  // Resolve legislator names for the grid
  type LegLite = { id: string; full_name: string; role: string; party: string | null };
  const legById = new Map<string, LegLite>();
  if (voteMembers.length > 0) {
    const legIds = [...new Set(voteMembers.map((v) => v.legislator_id).filter((x): x is string => !!x))];
    const { data } = await sb
      .from("legislators")
      .select("id, full_name, role, party")
      .in("id", legIds);
    for (const l of (data ?? []) as LegLite[]) legById.set(l.id, l);
  }

  // Group rolls by state for the index view
  const rollsByState = new Map<string, Roll[]>();
  for (const r of rolls) {
    if (!rollsByState.has(r.bill.state)) rollsByState.set(r.bill.state, []);
    rollsByState.get(r.bill.state)!.push(r);
  }
  const statesSorted = [...rollsByState.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/intel" className="text-zinc-500 hover:text-emerald-400">← Intel hub</Link>
      </div>

      <header className="mb-6 mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Voting record
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          {stateFilter ? `${stateFilter} voting record` : "Every kratom roll call we've recorded"}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Stance is a guess. A vote is a fact.{" "}
          {stateFilter
            ? "Side-by-side comparison of every recorded kratom-bill vote by every legislator in this state."
            : "Every roll call we've ingested across every kratom-relevant bill. Filter by state to see the side-by-side comparison grid."}
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          {rolls.length} roll call{rolls.length === 1 ? "" : "s"} across {statesSorted.length} state{statesSorted.length === 1 ? "" : "s"}.
          {!stateFilter && " Click a state below to see the comparison grid."}
        </p>
      </header>

      {/* State filter pills */}
      <nav className="mb-6 flex flex-wrap gap-1.5 text-xs">
        <Link
          href="/intel/votes"
          className={`rounded-full border px-3 py-1 ${
            !stateFilter
              ? "border-emerald-500 bg-emerald-950/30 font-semibold text-emerald-200"
              : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-emerald-500/60"
          }`}
        >
          All ({rolls.length})
        </Link>
        {statesSorted.map(([state, rs]) => (
          <Link
            key={state}
            href={`/intel/votes?state=${state}`}
            className={`rounded-full border px-3 py-1 ${
              stateFilter === state
                ? "border-emerald-500 bg-emerald-950/30 font-semibold text-emerald-200"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-emerald-500/60"
            }`}
          >
            {state} ({rs.length})
          </Link>
        ))}
      </nav>

      {/* State grid view */}
      {stateFilter && voteMembers.length > 0 && (
        <StateComparisonGrid
          rolls={stateRolls}
          members={voteMembers}
          legById={legById}
        />
      )}

      {/* Index view: roll calls grouped by state */}
      {!stateFilter && (
        <section className="space-y-6">
          {statesSorted.map(([state, rs]) => (
            <div key={state}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">
                <Link href={`/intel/votes?state=${state}`} className="hover:text-emerald-400">
                  {state} · {rs.length} roll call{rs.length === 1 ? "" : "s"}
                </Link>
              </h2>
              <ul className="space-y-1.5">
                {rs.map((r) => (
                  <RollCallRow key={r.id} roll={r} />
                ))}
              </ul>
            </div>
          ))}
          {statesSorted.length === 0 && (
            <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-500">
              No roll calls ingested yet. LegiScan sync populates these as bills move through chambers.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function RollCallRow({ roll }: { roll: { id: string; bill: { id: string; state: string; bill_number: string; title: string | null; kratom_relevance: string | null }; vote_date: string | null; chamber: string | null; motion: string | null; passed: boolean | null; yea_count: number | null; nay_count: number | null } }) {
  const passedTone = roll.passed === true
    ? "border-emerald-700/40 bg-emerald-950/10 text-emerald-200"
    : roll.passed === false
    ? "border-zinc-700 bg-zinc-900/40 text-zinc-300"
    : "border-zinc-800 bg-zinc-950/40 text-zinc-400";
  return (
    <li className={`rounded border px-3 py-2 text-[11px] ${passedTone}`}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link href={`/bills/${roll.bill.id}`} className="font-mono font-semibold text-zinc-100 hover:text-emerald-400">
          {roll.bill.state} {roll.bill.bill_number}
        </Link>
        {roll.bill.kratom_relevance === "anti" && (
          <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">Anti</span>
        )}
        {roll.bill.kratom_relevance === "pro" && (
          <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">Pro</span>
        )}
        {roll.chamber && (
          <span className="font-mono text-[10px] uppercase text-zinc-500">{roll.chamber}</span>
        )}
        <span className="text-zinc-300">{roll.motion}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-300">
          {roll.yea_count ?? 0}–{roll.nay_count ?? 0}
          {roll.passed === true && <span className="ml-1 font-bold text-emerald-300">PASSED</span>}
          {roll.passed === false && <span className="ml-1 text-zinc-500">failed</span>}
        </span>
        {roll.vote_date && (
          <span className="font-mono text-[10px] text-zinc-500">{roll.vote_date}</span>
        )}
      </div>
    </li>
  );
}

// ── Side-by-side comparison grid ────────────────────────────────────
function StateComparisonGrid({
  rolls,
  members,
  legById,
}: {
  rolls: Array<{ id: string; bill: { id: string; state: string; bill_number: string; title: string | null; kratom_relevance: string | null }; vote_date: string | null; motion: string | null; passed: boolean | null }>;
  members: Array<{ bill_vote_id: string; legislator_id: string | null; vote_text: string | null; vote_value: number | null }>;
  legById: Map<string, { id: string; full_name: string; role: string; party: string | null }>;
}) {
  // Determine which legislators voted on at least one of these rolls
  const legIdSet = new Set<string>();
  for (const m of members) {
    if (m.legislator_id && legById.has(m.legislator_id)) legIdSet.add(m.legislator_id);
  }
  // Sort legislators by their participation count (desc), then by name
  const participationCount = new Map<string, number>();
  for (const m of members) {
    if (m.legislator_id) {
      participationCount.set(m.legislator_id, (participationCount.get(m.legislator_id) ?? 0) + 1);
    }
  }
  const legs = [...legIdSet]
    .map((id) => legById.get(id)!)
    .sort((a, b) => {
      const pc = (participationCount.get(b.id) ?? 0) - (participationCount.get(a.id) ?? 0);
      if (pc !== 0) return pc;
      return a.full_name.localeCompare(b.full_name);
    });

  // Cell lookup: (roll_id × leg_id) → vote
  type Vote = { vote_text: string | null; vote_value: number | null };
  const cellMap = new Map<string, Vote>();
  for (const m of members) {
    if (m.legislator_id) {
      cellMap.set(`${m.bill_vote_id}::${m.legislator_id}`, { vote_text: m.vote_text, vote_value: m.vote_value });
    }
  }

  if (legs.length === 0) {
    return (
      <p className="rounded-md border border-amber-700/40 bg-amber-950/10 p-4 text-[11px] text-amber-200">
        No matched legislator votes for this state. The roll calls are recorded but the
        per-legislator name resolution hasn&apos;t matched yet — backfill in progress.
      </p>
    );
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/30">
      <table className="min-w-full text-[10px]">
        <thead className="sticky top-0 bg-zinc-950">
          <tr>
            <th className="border-b border-r border-zinc-800 px-2 py-2 text-left font-semibold uppercase tracking-wider text-zinc-400">
              Roll call
            </th>
            {legs.map((leg) => (
              <th key={leg.id} className="border-b border-r border-zinc-800 px-1.5 py-2 text-center align-bottom font-normal">
                <Link href={`/legislators/${leg.id}/briefing`} className="block hover:text-emerald-400">
                  <div className="origin-bottom rotate-[-45deg] text-[10px] whitespace-nowrap text-zinc-300">
                    {leg.full_name.split(" ").slice(-1)[0]}
                    {leg.party && <span className="ml-1 text-zinc-500">({leg.party[0]})</span>}
                  </div>
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rolls.map((r) => (
            <tr key={r.id} className="hover:bg-zinc-900/40">
              <td className="border-b border-r border-zinc-800 px-2 py-1.5 align-top">
                <Link href={`/bills/${r.bill.id}`} className="font-mono font-semibold text-zinc-100 hover:text-emerald-400">
                  {r.bill.bill_number}
                </Link>
                {r.bill.kratom_relevance === "anti" && (
                  <span className="ml-1 text-[9px] text-red-300">Anti</span>
                )}
                <div className="mt-0.5 text-[9px] text-zinc-500">
                  {r.motion?.slice(0, 40)}
                  {r.vote_date && <span className="ml-1">· {r.vote_date}</span>}
                </div>
              </td>
              {legs.map((leg) => {
                const v = cellMap.get(`${r.id}::${leg.id}`);
                return (
                  <td key={leg.id} className="border-b border-r border-zinc-900 px-1 py-1 text-center">
                    <VoteCell vote={v} kratomRelevance={r.bill.kratom_relevance} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Color-code the vote with the BILL's kratom-relevance in mind:
 *   - Voted Yea on an anti-kratom bill = bad signal (red)
 *   - Voted Nay on an anti-kratom bill = good signal (green)
 *   - Voted Yea on a pro-kratom bill = good (green)
 *   - Voted Nay on a pro-kratom bill = bad (red)
 *   - Other = neutral grey
 */
function VoteCell({ vote, kratomRelevance }: { vote: { vote_text: string | null; vote_value: number | null } | undefined; kratomRelevance: string | null }) {
  if (!vote) return <span className="text-zinc-700">·</span>;
  const v = vote.vote_value;
  let icon: string;
  let tone: string;
  if (v === 1) {
    icon = "Y";
    if (kratomRelevance === "anti") tone = "bg-red-900/60 text-red-100";
    else if (kratomRelevance === "pro") tone = "bg-emerald-900/60 text-emerald-100";
    else tone = "bg-zinc-800 text-zinc-200";
  } else if (v === 2) {
    icon = "N";
    if (kratomRelevance === "anti") tone = "bg-emerald-900/60 text-emerald-100";
    else if (kratomRelevance === "pro") tone = "bg-red-900/60 text-red-100";
    else tone = "bg-zinc-800 text-zinc-200";
  } else {
    icon = "—";
    tone = "bg-zinc-900 text-zinc-500";
  }
  return (
    <span
      className={`inline-block min-w-[18px] rounded px-1 py-0.5 font-mono text-[10px] font-bold ${tone}`}
      title={vote.vote_text ?? ""}
    >
      {icon}
    </span>
  );
}

import { createClient } from "@/lib/supabase/server";
import { getUserLegislators, type Legislator } from "@/lib/legislators";
import { LegislatorBrowser } from "./LegislatorBrowser";

export const metadata = { title: "Legislators" };

export default async function LegislatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state: stateParam } = await searchParams;
  const supabase = await createClient();

  // Default to user's state if signed in, else OK.
  let state = stateParam?.toUpperCase();
  let myReps: Legislator[] = [];

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select(
        "state, congressional_district, state_senate_district, state_house_district, city, county"
      )
      .eq("id", user.id)
      .single();
    if (!state) state = prof?.state ?? undefined;
    if (prof) myReps = await getUserLegislators(supabase, prof);
  }
  state = state || "OK";

  // All states for the picker
  const { data: allStates } = await supabase
    .from("states")
    .select("abbr, name")
    .order("name");

  // All legislators for this state (federal + state + local)
  const { data: legislators } = await supabase
    .from("legislators")
    .select(
      "id,state,role,district,full_name,party,email,phone,office_address,website,portrait_url,level,locality,body,title"
    )
    .eq("state", state)
    .eq("active", true)
    .order("full_name");

  const myRepIds = new Set(myReps.map((l) => l.id));

  // Per-legislator kratom-vote aggregate (one batched query; renders an
  // at-a-glance "voted to restrict N×" signal on directory cards, mirroring
  // the State HQ officials list). Plain object so it serializes to the client.
  const legIds = (legislators ?? []).map((l) => l.id);
  const voteAgg: Record<string, { restrict: number; total: number }> = {};
  if (legIds.length > 0) {
    type AggRow = { legislator_id: string | null; vote_value: number | null; bill_votes: { bills: { kratom_relevance: string | null }[] | { kratom_relevance: string | null } | null }[] | { bills: { kratom_relevance: string | null }[] | { kratom_relevance: string | null } | null } | null };
    const { data: vm } = await supabase
      .from("bill_vote_members")
      .select("legislator_id, vote_value, bill_votes!inner(bills!inner(kratom_relevance))")
      .in("legislator_id", legIds);
    for (const r of ((vm ?? []) as unknown as AggRow[])) {
      if (!r.legislator_id) continue;
      const bv = Array.isArray(r.bill_votes) ? r.bill_votes[0] : r.bill_votes;
      const b = bv ? (Array.isArray(bv.bills) ? bv.bills[0] : bv.bills) : null;
      if (!b) continue;
      const cur = voteAgg[r.legislator_id] ?? { restrict: 0, total: 0 };
      cur.total++;
      if ((r.vote_value === 1 && b.kratom_relevance === "anti") || (r.vote_value === 2 && b.kratom_relevance === "pro")) cur.restrict++;
      voteAgg[r.legislator_id] = cur;
    }
  }

  return (
    <LegislatorBrowser
      state={state}
      stateName={allStates?.find((s) => s.abbr === state)?.name ?? state}
      states={allStates ?? []}
      legislators={(legislators ?? []) as Legislator[]}
      myRepIds={Array.from(myRepIds)}
      isSignedIn={!!user}
      voteAgg={voteAgg}
    />
  );
}

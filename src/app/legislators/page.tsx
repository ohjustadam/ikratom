import { createClient } from "@/lib/supabase/server";
import { getUserLegislators, type Legislator } from "@/lib/legislators";
import { LegislatorBrowser, type LocalPlace } from "./LegislatorBrowser";

export const metadata = { title: "Legislators" };

export default async function LegislatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; place?: string; tab?: string }>;
}) {
  const { state: stateParam, place: placeParam, tab } = await searchParams;
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

  // State + federal officials. Local officials load one place at a time
  // (?place=): since 2026-10-09 whole states of county boards are on file
  // (Tennessee 1,678), and loading them all ran past the 1,000-row cap, which
  // silently cut off whoever sorted last — state legislators included.
  const COLS = "id,state,role,district,full_name,party,email,phone,office_address,website,portrait_url,level,locality,body,title";
  const { data: statewide } = await supabase
    .from("legislators")
    .select(COLS)
    .eq("state", state)
    .eq("active", true)
    .in("level", ["state", "federal"])
    .order("full_name");

  const { data: placeRows } = await supabase.rpc("local_official_places", { p_state: state });
  const localPlaces = (placeRows ?? []) as LocalPlace[];
  const place = placeParam && localPlaces.some((p) => p.locality === placeParam) ? placeParam : null;
  let placeOfficials: Legislator[] = [];
  if (place) {
    const { data } = await supabase
      .from("legislators")
      .select(COLS)
      .eq("state", state)
      .eq("active", true)
      .in("level", ["county", "municipal"])
      .eq("locality", place)
      .order("full_name")
      .limit(300);
    placeOfficials = (data ?? []) as Legislator[];
  }
  // The viewer's own local reps always come along, so "Only mine" still works.
  const mineLocal = myReps.filter((l) => l.state === state && (l.level === "county" || l.level === "municipal"));
  const seen = new Set<string>();
  const legislators = [...((statewide ?? []) as Legislator[]), ...placeOfficials, ...mineLocal]
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));

  const myRepIds = new Set(myReps.map((l) => l.id));

  // Per-legislator kratom-vote aggregate (one batched query; renders an
  // at-a-glance "voted to restrict N×" signal on directory cards, mirroring
  // the State HQ officials list). Plain object so it serializes to the client.
  const legIds = (legislators ?? []).map((l) => l.id);
  const voteAgg: Record<string, { restrict: number; total: number }> = {};
  if (legIds.length > 0) {
    type AggRow = { legislator_id: string | null; vote_value: number | null; bill_votes: { bills: { kratom_relevance: string | null }[] | { kratom_relevance: string | null } | null }[] | { bills: { kratom_relevance: string | null }[] | { kratom_relevance: string | null } | null } | null };
    // Paginate past the PostgREST 1000-row cap — a single unbounded select
    // silently truncated vote rows and undercounted the "voted to restrict N×"
    // signal once the platform crossed 1000 kratom-vote-member rows.
    const vm: AggRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page } = await supabase
        .from("bill_vote_members")
        .select("legislator_id, vote_value, bill_votes!inner(bills!inner(kratom_relevance))")
        .in("legislator_id", legIds)
        .range(from, from + 999);
      const rows = (page ?? []) as unknown as AggRow[];
      vm.push(...rows);
      if (rows.length < 1000) break;
    }
    for (const r of vm) {
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
      legislators={legislators}
      localPlaces={localPlaces}
      place={place}
      initialTab={tab === "local" || place ? "local" : "all"}
      myRepIds={Array.from(myRepIds)}
      isSignedIn={!!user}
      voteAgg={voteAgg}
    />
  );
}

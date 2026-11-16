import { createClient } from "@/lib/supabase/server";
import { getUserLegislators, type Legislator } from "@/lib/legislators";
import {
  EMPTY_DIRECTORY,
  getPlaceOfficials,
  getStateDirectory,
  voteAggregate,
  type StateDirectory,
  type VoteAgg,
} from "@/lib/legislator-directory";
import { LegislatorBrowser } from "./LegislatorBrowser";

export const metadata = { title: "Legislators" };

// The public half (officials, places, vote tallies) comes from a per-state
// cache shared by every viewer (src/lib/legislator-directory.ts). Only the
// viewer's own reps are read per request.
function directory(state: string): Promise<StateDirectory> {
  return getStateDirectory(state).catch(() => EMPTY_DIRECTORY);
}

export default async function LegislatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; place?: string; tab?: string }>;
}) {
  const { state: stateParam, place: placeParam, tab } = await searchParams;
  const supabase = await createClient();

  // Default to user's state if signed in, else OK. A named state starts its
  // directory read now, alongside the auth check.
  const requested = stateParam?.toUpperCase();
  const early = requested ? directory(requested) : null;
  let state = requested;
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
      .maybeSingle();
    if (!state) state = prof?.state ?? undefined;
    if (prof) myReps = await getUserLegislators(supabase, prof);
  }
  state = state || "OK";
  const dir = await (early ?? directory(state));

  const place = placeParam && dir.localPlaces.some((p) => p.locality === placeParam) ? placeParam : null;
  const placeSet = place
    ? await getPlaceOfficials(state, place).catch(() => ({ officials: [] as Legislator[], voteAgg: {} as VoteAgg }))
    : { officials: [] as Legislator[], voteAgg: {} as VoteAgg };

  // The viewer's own local reps always come along, so "Only mine" still works.
  const mineLocal = myReps.filter((l) => l.state === state && (l.level === "county" || l.level === "municipal"));
  const seen = new Set<string>();
  const legislators = [...dir.statewide, ...placeSet.officials, ...mineLocal]
    .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));

  const myRepIds = new Set(myReps.map((l) => l.id));

  // Tallies for the cached sets come with them; only a signed-in viewer's own
  // local reps outside the chosen place need a per-request read.
  const covered = new Set([...dir.statewide, ...placeSet.officials].map((l) => l.id));
  const extraIds = mineLocal.map((l) => l.id).filter((id) => !covered.has(id));
  const extraAgg = extraIds.length ? await voteAggregate(supabase, extraIds).catch(() => ({})) : {};
  const voteAgg: VoteAgg = { ...dir.voteAgg, ...placeSet.voteAgg, ...extraAgg };

  return (
    <LegislatorBrowser
      state={state}
      stateName={dir.states.find((s) => s.abbr === state)?.name ?? state}
      states={dir.states}
      legislators={legislators}
      localPlaces={dir.localPlaces}
      place={place}
      initialTab={tab === "local" || place ? "local" : "all"}
      myRepIds={Array.from(myRepIds)}
      isSignedIn={!!user}
      voteAgg={voteAgg}
    />
  );
}

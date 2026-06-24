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

  return (
    <LegislatorBrowser
      state={state}
      stateName={allStates?.find((s) => s.abbr === state)?.name ?? state}
      states={allStates ?? []}
      legislators={(legislators ?? []) as Legislator[]}
      myRepIds={Array.from(myRepIds)}
      isSignedIn={!!user}
    />
  );
}

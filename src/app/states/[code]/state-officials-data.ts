import { unstable_cache } from "next/cache";
import { createAnonClient } from "@/lib/supabase/anon";
import { publicSnapshot, type SnapshotLoad } from "@/lib/public-snapshots";
import { chunk, tallyKratomVotes, VOTE_ID_CHUNK, type VoteMemberRow, type VoteTally } from "@/lib/vote-tally";

export type Official = {
  id: string;
  full_name: string;
  role: string;
  party: string | null;
  district: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  portrait_url: string | null;
  website: string | null;
};

export type StateOfficialsData = {
  officials: Official[];
  places: Array<{ locality: string; level: string; n: number }>;
  votes: Record<string, VoteTally>;
};

/**
 * The officials directory's public reads, once per state.
 *
 * WHY CACHED (2026-10-13): these three reads ran on EVERY render of every State
 * HQ page, outside the hub snapshot — up to ~250 KB from Supabase per render
 * (New Hampshire: 419 officials, 142 KB). Rosters and recorded votes change
 * when the syncs run, not by the minute, so six hours in R2 (one hour in this
 * deploy's cache) loses nothing a reader would notice.
 *
 * Cookie-LESS (anon client): everything here is public record, and not reading
 * cookies is what lets State HQ stay a cached static page.
 */
async function loadStateOfficials(state: string): Promise<SnapshotLoad<StateOfficialsData>> {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("legislators")
    .select("id, full_name, role, party, district, email, phone, title, portrait_url, website")
    .eq("state", state)
    .eq("active", true)
    // State + federal only. Whole states of county boards are on file since
    // 2026-10-09 (Tennessee 1,678); listed here they sorted ahead of the
    // legislature ("county_…" < "state_…") and pushed it past this limit.
    .in("level", ["state", "federal"])
    .order("role")
    .order("full_name")
    .limit(500);
  // Throw, don't return empty: a failing Supabase must serve the last good
  // snapshot, never cache "this state has no officials".
  if (error) throw new Error(`state officials ${state}: ${error.message}`);
  const officials = (data ?? []) as Official[];
  if (officials.length === 0) return { data: { officials, places: [], votes: {} }, cacheable: true };

  const [placesRes, voteRes] = await Promise.all([
    supabase.rpc("local_official_places", { p_state: state }),
    Promise.all(
      chunk(officials.map((o) => o.id), VOTE_ID_CHUNK).map((ids) =>
        supabase
          .from("bill_vote_members")
          .select("legislator_id, vote_value, bill_votes!inner(bills!inner(kratom_relevance))")
          .in("legislator_id", ids),
      ),
    ),
  ]);
  const rows = voteRes.flatMap((r) => (r.data ?? []) as unknown as VoteMemberRow[]);
  return {
    data: {
      officials,
      places: (placesRes.data ?? []) as StateOfficialsData["places"],
      votes: tallyKratomVotes(rows),
    },
    // A failed part may mean missing votes or places: show it, never store it.
    cacheable: !placesRes.error && voteRes.every((r) => !r.error),
  };
}

/** Bump "v1" if StateOfficialsData's shape changes. */
export const getStateOfficials = unstable_cache(
  (state: string) => publicSnapshot("state-officials", "v1", state, 6 * 3600, () => loadStateOfficials(state)),
  ["state-officials"],
  { revalidate: 3600, tags: ["state-hub"] },
);

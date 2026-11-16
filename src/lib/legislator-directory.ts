import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient } from "@/lib/supabase/anon";
import type { Legislator } from "@/lib/legislators";

/**
 * The public read-set behind `/legislators`, cached per state (and per place).
 *
 * WHY (2026-11-10): the directory rendered on every hit with ~5 sequential
 * database round trips (states, statewide officials, the place list, then the
 * vote tally pages), ~1.1 s at p50 on Netlify, 534 function runs a day. Crawlers
 * walk it one `?state=&place=` combination at a time, so the edge cache barely
 * helps; what helps is not repeating the per-state work for every place and
 * every visitor. Everything here is identical for every viewer, so it is read
 * with the ANONYMOUS client (RLS as a logged-out visitor; checked 2026-11-10 to
 * return the same rows as the service role for states, officials, places and
 * votes). The viewer's own reps stay on the request-bound client in the page.
 *
 * Fresh to 15 minutes, the same window as the profile snapshot and the
 * Cloudflare rule for this page, and refreshed with it by the
 * "legislator-detail" tag.
 */

export const DIRECTORY_COLS =
  "id,state,role,district,full_name,party,email,phone,office_address,website,portrait_url,level,locality,body,title";

export type LocalPlace = { locality: string; level: string; n: number };
export type VoteAgg = Record<string, { restrict: number; total: number }>;
export type StateDirectory = {
  states: { abbr: string; name: string }[];
  statewide: Legislator[];
  localPlaces: LocalPlace[];
  voteAgg: VoteAgg;
};

const STATE_RE = /^[A-Z]{2}$/;
const TTL = { revalidate: 900, tags: ["legislator-detail"] };

/**
 * Per-legislator kratom-vote tally: the "voted to restrict N×" signal on the
 * directory cards. Paginates past the PostgREST 1000-row cap, ordered so the
 * pages cannot overlap (an unordered `.range()` repeats rows).
 */
export async function voteAggregate(sb: SupabaseClient, ids: string[]): Promise<VoteAgg> {
  const agg: VoteAgg = {};
  if (ids.length === 0) return agg;
  type Bill = { kratom_relevance: string | null };
  type BV = { bills: Bill[] | Bill | null };
  type Row = { legislator_id: string | null; vote_value: number | null; bill_votes: BV[] | BV | null };
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("bill_vote_members")
      .select("legislator_id, vote_value, bill_votes!inner(bills!inner(kratom_relevance))")
      .in("legislator_id", ids)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      if (!r.legislator_id) continue;
      const bv = Array.isArray(r.bill_votes) ? r.bill_votes[0] : r.bill_votes;
      const b = bv ? (Array.isArray(bv.bills) ? bv.bills[0] : bv.bills) : null;
      if (!b) continue;
      const cur = agg[r.legislator_id] ?? { restrict: 0, total: 0 };
      cur.total++;
      if ((r.vote_value === 1 && b.kratom_relevance === "anti") || (r.vote_value === 2 && b.kratom_relevance === "pro")) cur.restrict++;
      agg[r.legislator_id] = cur;
    }
    if (rows.length < 1000) break;
  }
  return agg;
}

async function loadStateDirectory(state: string): Promise<StateDirectory> {
  const sb = createAnonClient();
  // State + federal officials. Local officials load one place at a time
  // (?place=): since 2026-10-09 whole states of county boards are on file
  // (Tennessee 1,678), and loading them all ran past the 1,000-row cap.
  const [statesRes, statewideRes, placesRes] = await Promise.all([
    sb.from("states").select("abbr, name").order("name"),
    sb.from("legislators").select(DIRECTORY_COLS).eq("state", state).eq("active", true)
      .in("level", ["state", "federal"]).order("full_name"),
    sb.rpc("local_official_places", { p_state: state }),
  ]);
  // Throwing keeps a failed read out of the cache; the page renders empty
  // lists for this one request, as it did before.
  if (statesRes.error) throw statesRes.error;
  if (statewideRes.error) throw statewideRes.error;
  if (placesRes.error) throw placesRes.error;
  const statewide = (statewideRes.data ?? []) as unknown as Legislator[];
  return {
    states: (statesRes.data ?? []) as StateDirectory["states"],
    statewide,
    localPlaces: (placesRes.data ?? []) as LocalPlace[],
    voteAgg: await voteAggregate(sb, statewide.map((l) => l.id)),
  };
}

async function loadPlaceOfficials(state: string, place: string): Promise<{ officials: Legislator[]; voteAgg: VoteAgg }> {
  const sb = createAnonClient();
  const { data, error } = await sb.from("legislators").select(DIRECTORY_COLS).eq("state", state).eq("active", true)
    .in("level", ["county", "municipal"]).eq("locality", place).order("full_name").limit(300);
  if (error) throw error;
  const officials = (data ?? []) as unknown as Legislator[];
  return { officials, voteAgg: await voteAggregate(sb, officials.map((l) => l.id)) };
}

const cachedStateDirectory = unstable_cache(loadStateDirectory, ["legislator-directory-v1"], TTL);
const cachedPlaceOfficials = unstable_cache(loadPlaceOfficials, ["legislator-directory-place-v1"], TTL);

/** Only a two-letter code gets a cache entry, so junk `?state=` values can't fill it. */
export function getStateDirectory(state: string): Promise<StateDirectory> {
  return STATE_RE.test(state) ? cachedStateDirectory(state) : loadStateDirectory(state);
}

/** `place` must already be one of the state's `localPlaces` (validated by the caller). */
export function getPlaceOfficials(state: string, place: string) {
  return STATE_RE.test(state) ? cachedPlaceOfficials(state, place) : loadPlaceOfficials(state, place);
}

export const EMPTY_DIRECTORY: StateDirectory = { states: [], statewide: [], localPlaces: [], voteAgg: {} };

import "server-only";

import { unstable_cache } from "next/cache";
import { createAnonClient } from "@/lib/supabase/anon";
import { buildRecords, type RecordBill, type RecordEntry, type SponsorRow, type VoteRow } from "@/lib/kratom-record";

/**
 * The kratom record of a campaign's officials, for the recipient chips:
 * bills sponsored and recorded votes, each bill tagged with the axis its text
 * addresses. Public data through the ANONYMOUS client, cached for an hour per
 * target set, because one state-floor campaign is the same list for every
 * member and the raw rows are large (Oklahoma: 752 vote rows, ~580 KB).
 */

const BILL =
  "id, state, bill_number, title, status, session_id, kratom_relevance, " +
  "leaf_stance:substance_targeting->natural_leaf->>stance, leaf_conf:substance_targeting->natural_leaf->>confidence, " +
  "oh_stance:substance_targeting->seven_oh->>stance, oh_conf:substance_targeting->seven_oh->>confidence";

type RawBill = Omit<RecordBill, "leaf" | "seven_oh"> & {
  leaf_stance: string | null; leaf_conf: string | null; oh_stance: string | null; oh_conf: string | null;
};
type RawVote = { legislator_id: string; vote_text: string | null; vote_value: string | null; bill_votes: { vote_date: string | null; motion: string | null; bills: RawBill } };
type RawSpons = { legislator_id: string; classification: string | null; bills: RawBill };

const toBill = (b: RawBill): RecordBill => ({
  id: b.id, state: b.state, bill_number: b.bill_number, title: b.title, status: b.status, session_id: b.session_id,
  leaf: { stance: b.leaf_stance, confidence: b.leaf_conf },
  seven_oh: { stance: b.oh_stance, confidence: b.oh_conf },
});

async function load(idList: string): Promise<[string, RecordEntry[]][]> {
  const ids = idList.split(",").filter(Boolean);
  const sb = createAnonClient();
  const votes: VoteRow[] = [];
  const sponsors: SponsorRow[] = [];
  // Chunked so a 400-seat chamber never builds an over-long request URL.
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const [v, s] = await Promise.all([
      sb.from("bill_vote_members")
        .select(`legislator_id, vote_text, vote_value, bill_votes!inner(vote_date, motion, bills!inner(${BILL}))`)
        .in("legislator_id", chunk).in("bill_votes.bills.kratom_relevance", ["pro", "anti"]).limit(5000),
      sb.from("bill_sponsors")
        .select(`legislator_id, classification, bills!inner(${BILL})`)
        .in("legislator_id", chunk).in("bills.kratom_relevance", ["pro", "anti"]).limit(5000),
    ]);
    // Throw, so a failed read is never cached as "nobody has a record".
    if (v.error) throw v.error;
    if (s.error) throw s.error;
    for (const r of (v.data ?? []) as unknown as RawVote[]) {
      votes.push({
        legislator_id: r.legislator_id, vote_text: r.vote_text, vote_value: r.vote_value == null ? null : String(r.vote_value),
        vote_date: r.bill_votes.vote_date, motion: r.bill_votes.motion, bill: toBill(r.bill_votes.bills),
      });
    }
    for (const r of (s.data ?? []) as unknown as RawSpons[]) {
      sponsors.push({ legislator_id: r.legislator_id, classification: r.classification, bill: toBill(r.bills) });
    }
  }
  return [...buildRecords(votes, sponsors).entries()];
}

const cached = unstable_cache(load, ["campaign-target-record-v1"], { revalidate: 3600, tags: ["kratom-record"] });

/** Per legislator id, their kratom record. Empty (never throws) when the read fails. */
export async function getTargetRecords(ids: string[]): Promise<Map<string, RecordEntry[]>> {
  if (ids.length === 0) return new Map();
  try {
    return new Map(await cached([...new Set(ids)].sort().join(",")));
  } catch (e) {
    console.error("[campaign] target record load failed", e);
    return new Map();
  }
}

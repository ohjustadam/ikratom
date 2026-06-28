import { createClient } from "@/lib/supabase/server";
import { STANCE_TOPICS, type StanceTopic } from "@/lib/legislator-action-plan";

/**
 * Read helper for the /topics explorer (multi-topic bill foundation, phase 1).
 * Bills are tagged with `bill_topics` (migration 0223) — which substance-policy
 * topics each touches. We fetch the tagged set (small today: the kratom-bill
 * universe, ~700) and group in JS, avoiding jsonb-path filter quirks. As
 * dedicated per-topic discovery rolls out (phase 2), swap to a topic-filtered
 * query before this exceeds the 1000-row cap.
 */
export type TopicTag = { stance: string; method: string; matched?: string[]; confidence?: number };
export type TopicBill = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  status: string | null;
  last_action_at: string | null;
  kratom_relevance: string | null;
  bill_topics: Record<string, TopicTag> | null;
};

export async function getBillsWithTopics(): Promise<TopicBill[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("bills")
    .select("id, state, bill_number, title, status, last_action_at, kratom_relevance, bill_topics")
    .not("bill_topics", "is", null)
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  return (data ?? []) as TopicBill[];
}

/** Count of tagged bills per topic. */
export function topicCounts(bills: TopicBill[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of STANCE_TOPICS) c[t] = 0;
  for (const b of bills) {
    for (const t of Object.keys(b.bill_topics ?? {})) {
      if (t in c) c[t]++;
    }
  }
  return c;
}

export function isStanceTopic(t: string): t is StanceTopic {
  return (STANCE_TOPICS as readonly string[]).includes(t);
}

export const STANCE_TONE: Record<string, string> = {
  restrictive: "bg-red-950/40 text-red-300",
  permissive: "bg-emerald-950/40 text-emerald-300",
  mixed: "bg-amber-950/40 text-amber-300",
  unknown: "bg-zinc-900 text-zinc-500",
};

import { createClient } from "@/lib/supabase/server";
import { STANCE_TOPICS, type StanceTopic } from "@/lib/legislator-action-plan";

/**
 * Read helpers for the /topics explorer. Two sources, unioned:
 *  - TRACKED: bills.bill_topics (migration 0223) — kratom bills + the cross-topic
 *    ones that also touch another substance. These have a full /bills/[id] page.
 *  - DISCOVERED: topic_bills (migration 0224) — non-kratom bills found via
 *    LegiScan, kept out of the bills table so kratom surfaces stay clean. These
 *    link out to LegiScan.
 * Deduped by legiscan_bill_id (a kratom bill that also matched a topic search
 * shows once, as the tracked record). topic_bills is filtered per-topic at the
 * DB level (each topic <1000; the table as a whole exceeds the row cap).
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
  legiscan_bill_id: number | null;
  bill_topics: Record<string, TopicTag> | null;
};

export type UnifiedBill = {
  key: string;
  source: "tracked" | "discovered";
  state: string;
  bill_number: string;
  title: string | null;
  stance: string;
  lastDate: string | null;
  href: string;
  external: boolean;
  otherTopics: string[];
};

async function getBillsWithTopics(): Promise<TopicBill[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("bills")
    .select("id, state, bill_number, title, status, last_action_at, kratom_relevance, legiscan_bill_id, bill_topics")
    .not("bill_topics", "is", null)
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(1000);
  return (data ?? []) as TopicBill[];
}

/** Per-topic bill counts (tracked + discovered, kratom has no discovered). */
export async function getTopicCounts(): Promise<Record<string, number>> {
  const sb = await createClient();
  const tracked = await getBillsWithTopics();
  const counts: Record<string, number> = {};
  for (const t of STANCE_TOPICS) counts[t] = 0;
  for (const b of tracked) {
    for (const t of Object.keys(b.bill_topics ?? {})) if (t in counts) counts[t]++;
  }
  await Promise.all(
    STANCE_TOPICS.filter((t) => t !== "kratom").map(async (t) => {
      const { count } = await sb.from("topic_bills").select("legiscan_bill_id", { count: "exact", head: true }).eq("topic", t);
      counts[t] += count ?? 0; // small overlap with cross-topic tracked bills; deduped on the per-topic page
    })
  );
  return counts;
}

/** Merged, deduped bills for one topic (tracked first, then non-dup discovered). */
export async function getBillsForTopic(topic: StanceTopic): Promise<UnifiedBill[]> {
  const sb = await createClient();
  const tracked = (await getBillsWithTopics()).filter((b) => b.bill_topics && topic in b.bill_topics);
  const trackedIds = new Set<number>();
  const rows: UnifiedBill[] = tracked.map((b) => {
    if (b.legiscan_bill_id) trackedIds.add(b.legiscan_bill_id);
    return {
      key: `t:${b.id}`,
      source: "tracked",
      state: b.state,
      bill_number: b.bill_number,
      title: b.title,
      stance: b.bill_topics![topic].stance,
      lastDate: b.last_action_at,
      href: `/bills/${b.id}`,
      external: false,
      otherTopics: Object.keys(b.bill_topics ?? {}).filter((t) => t !== topic && t in STANCE_TOPIC_SET),
    };
  });

  if (topic !== "kratom") {
    const { data: disc } = await sb
      .from("topic_bills")
      .select("legiscan_bill_id, state, bill_number, title, stance, last_action_date, url")
      .eq("topic", topic)
      .order("last_action_date", { ascending: false, nullsFirst: false })
      .limit(1000);
    for (const d of (disc ?? []) as Array<{ legiscan_bill_id: number; state: string; bill_number: string; title: string | null; stance: string | null; last_action_date: string | null; url: string | null }>) {
      if (trackedIds.has(d.legiscan_bill_id)) continue; // already shown as tracked
      rows.push({
        key: `d:${d.legiscan_bill_id}`,
        source: "discovered",
        state: d.state,
        bill_number: d.bill_number,
        title: d.title,
        stance: d.stance ?? "unknown",
        lastDate: d.last_action_date,
        href: d.url ?? `https://legiscan.com/${d.state}`,
        external: true,
        otherTopics: [],
      });
    }
  }

  rows.sort((a, z) => (z.lastDate ?? "").localeCompare(a.lastDate ?? ""));
  return rows;
}

const STANCE_TOPIC_SET = Object.fromEntries(STANCE_TOPICS.map((t) => [t, true]));

export function isStanceTopic(t: string): t is StanceTopic {
  return (STANCE_TOPICS as readonly string[]).includes(t);
}

export const STANCE_TONE: Record<string, string> = {
  restrictive: "bg-red-950/40 text-red-300",
  permissive: "bg-emerald-950/40 text-emerald-300",
  mixed: "bg-amber-950/40 text-amber-300",
  unknown: "bg-zinc-900 text-zinc-500",
};

/**
 * Story matching — find resonant kratom_stories for a given target.
 *
 * Use cases:
 *   - Operation Response page: surface stories an advocate can paste
 *     into their email to chairs/sponsors. Real human stories from
 *     advocates in the target state move legislators in a way that
 *     talking points never will.
 *   - Per-bill page (future): same, scoped to one bill.
 *
 * v1: simple tag + state + posture matching. Approved + non-deleted
 * stories only. Ranked by:
 *   1. In-state stories (state matches target state) outrank others
 *   2. Tag overlap with the cluster's topic profile
 *   3. Recency tiebreak
 *
 * v2 idea: embed every story body + match via cosine similarity to
 * bill title/summary. Needs story-embedding generation + storage.
 *
 * Privacy: only `display_name` is exposed publicly — never `author_id`.
 * Authors choose anonymous=true or pick a display name at submit time.
 */

import { createClient } from "@/lib/supabase/server";

export type MatchedStory = {
  id: string;
  display_name: string | null;
  state: string | null;
  title: string | null;
  body: string;
  tags: string[];
  is_local: boolean;
  upvote_count: number;
};

// Map cluster slug → story tags that are most resonant with the
// operation's premise. Hand-curated; v2 derives this from cluster
// signature phrases via embedding.
const CLUSTER_TAG_MAP: Record<string, string[]> = {
  kcpa: ["safety", "consumer_protection", "shop_owner", "labeling"],
  synthetic_ban_only: ["natural_leaf", "shop_owner", "purity", "7-OH"],
  schedule_i_total_ban: ["pain", "recovery", "veteran", "withdrawal_management", "opioid_alternative"],
  age_21_only: ["age", "addiction_recovery", "young_adult"],
  labeling_lab_testing: ["safety", "shop_owner", "consumer_protection"],
  municipal_prohibition: ["shop_owner", "small_business", "access"],
  retail_license: ["shop_owner", "small_business", "regulation"],
  ice_out: ["safety", "intoxication", "natural_leaf"],
};

export async function matchStoriesForCluster(
  cluster_slug: string,
  viewer_state: string | null,
  limit = 3,
): Promise<MatchedStory[]> {
  const sb = await createClient();
  const tags = CLUSTER_TAG_MAP[cluster_slug] ?? [];

  // Pull all approved, non-deleted stories. We rank in code rather
  // than SQL because the scoring depends on tag-overlap counts.
  const { data } = await sb
    .from("kratom_stories")
    .select("id, display_name, anonymous, state, title, body, tags, upvote_count, approved_at, created_at")
    .eq("moderation_status", "approved")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(60);
  type Raw = {
    id: string; display_name: string | null; anonymous: boolean;
    state: string | null; title: string | null; body: string;
    tags: string[] | null; upvote_count: number | null;
    approved_at: string | null; created_at: string;
  };
  const rows = (data ?? []) as Raw[];
  if (rows.length === 0) return [];

  const scored = rows.map((r) => {
    let score = 0;
    if (viewer_state && r.state === viewer_state) score += 10;
    // Tag overlap
    const overlap = (r.tags ?? []).filter((t) => tags.includes(t)).length;
    score += overlap * 2;
    // Upvotes as social signal
    score += Math.min(5, r.upvote_count ?? 0);
    return { r, score };
  });
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ r }) => ({
    id: r.id,
    display_name: r.anonymous ? null : r.display_name,
    state: r.state,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    is_local: !!(viewer_state && r.state === viewer_state),
    upvote_count: r.upvote_count ?? 0,
  }));
}

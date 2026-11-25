import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { pickTop5, monthStartEastern, type BoardCandidate } from "@/lib/media-board";

/**
 * Data for the /media Top 5 board, cached for an hour like the page itself.
 * Service role, because the counting functions (migration 0331) are
 * service-role only: no client can list who ticked what.
 */
export type BoardStory = BoardCandidate & { emailed: number; commented: number };
export type Leader = { handle: string | null; actions: number };

type ContactRow = {
  id: string;
  name: string | null;
  outlet: string | null;
  news_items: { id: string; title: string; published_at: string | null; ai_relevance_score: number | null; duplicate_of: string | null } | null;
};

export const getWeeklyBoard = unstable_cache(
  async (): Promise<BoardStory[]> => {
    const sb = createServiceRoleClient();
    const since = new Date(Date.now() - 8 * 864e5).toISOString();
    const { data } = await sb
      .from("press_contacts")
      .select("id, name, outlet, news_items!inner(id, title, published_at, ai_relevance_score, duplicate_of)")
      .eq("kind", "reporter")
      .gte("news_items.published_at", since)
      .limit(200);
    const candidates: BoardCandidate[] = ((data ?? []) as unknown as ContactRow[])
      .filter((r) => r.news_items && !r.news_items.duplicate_of)
      .map((r) => ({
        contactId: r.id, newsId: r.news_items!.id, title: r.news_items!.title, name: r.name, outlet: r.outlet,
        publishedAt: r.news_items!.published_at, score: r.news_items!.ai_relevance_score,
      }));
    const top = pickTop5(candidates);
    if (!top.length) return [];
    const { data: counts } = await sb.rpc("media_board_counts", { p_ids: top.map((t) => t.newsId) });
    const byId = new Map(((counts ?? []) as { news_item_id: string; emailed: number; commented: number }[]).map((c) => [c.news_item_id, c]));
    return top.map((t) => ({ ...t, emailed: byId.get(t.newsId)?.emailed ?? 0, commented: byId.get(t.newsId)?.commented ?? 0 }));
  },
  ["media-board-week"],
  { revalidate: 3600, tags: ["media-board"] },
);

export const getMonthlyLeaders = unstable_cache(
  async (): Promise<Leader[]> => {
    const sb = createServiceRoleClient();
    const { data } = await sb.rpc("media_board_leaderboard", { p_since: monthStartEastern(), p_limit: 10 });
    const rows = (data ?? []) as { user_id: string; actions: number }[];
    if (!rows.length) return [];
    // Public profiles only: the service role has no auth.uid(), so nobody's own exception applies.
    const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: rows.map((r) => r.user_id) });
    const handles = new Map(((profs ?? []) as { id: string; username: string | null }[]).map((p) => [p.id, p.username]));
    return rows.map((r) => ({ handle: handles.get(r.user_id) ?? null, actions: r.actions }));
  },
  ["media-board-month"],
  { revalidate: 3600, tags: ["media-board"] },
);

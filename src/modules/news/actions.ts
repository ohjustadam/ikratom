"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";

// All public listings filter to canonicals (duplicate_of IS NULL) so each
// syndicated story shows exactly once. The canonical row exposes
// `duplicate_count` for the "also reported in N other states" badge.
// Joins to bills via the (post-#326) news_items.bill_id linkage so the
// /news card can show "→ NY S 8925" with a click-through to the bill.
const NEWS_FIELDS =
  "id, state, title, summary, url, source_name, published_at, scraped_at, " +
  "kratom_topic, ai_relevance_score, duplicate_count, " +
  "bill_id, bills(bill_number, state)";

// Supabase generated types lag the migration that added duplicate_count, so
// we declare the row shape here and cast at the return boundary.
export type NewsListItem = {
  id: string;
  state: string | null;
  title: string;
  summary: string | null;
  url: string;
  source_name: string | null;
  published_at: string | null;
  scraped_at: string | null;
  kratom_topic: string | null;
  ai_relevance_score: number | null;
  duplicate_count: number | null;
  bill_id: string | null;
  // Supabase returns the joined row as a single object (because the FK
  // is many-to-one) but the generated types sometimes shape it as an
  // array. Accept both and normalize at the boundary.
  bills:
    | { bill_number: string; state: string }
    | Array<{ bill_number: string; state: string }>
    | null;
};

// False-positive defense: filter out items whose title+summary+body
// fetch proved kratom-free (`body_has_kratom_keyword = false`). NULL
// passes through — fresh items awaiting verification still display.
// See migration 0103 + scripts/verify-news-body.mjs.
export async function listNewsForState(state: string | null, limit = 20): Promise<NewsListItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("news_items")
    .select(NEWS_FIELDS)
    .eq("active", true)
    .is("duplicate_of", null)
    .not("body_has_kratom_keyword", "is", false);

  if (state === null) {
    q = q.is("state", null);
  } else {
    q = q.eq("state", state);
  }

  const { data } = await q
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("ai_relevance_score", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as NewsListItem[];
}

export async function listAllRecentNews(limit = 50): Promise<NewsListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("news_items")
    .select(NEWS_FIELDS)
    .eq("active", true)
    .is("duplicate_of", null)
    .not("body_has_kratom_keyword", "is", false)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as unknown as NewsListItem[];
}

/**
 * Corpus-wide news search — the WHOLE archive (6k+ items), title + summary +
 * article BODY, not the old client-side title filter over the latest 250.
 *
 * Primary: Postgres full-text search over the `search_tsv` GIN index (migration
 * 0206) via websearch_to_tsquery — Google-style multi-word / quoted / -excluded
 * terms, stemmed + ranked-by-recency. Falls back to a corpus-wide ILIKE over
 * title/summary/body_extract_excerpt if `search_tsv` isn't present yet (so the
 * feature works the instant it deploys, before the migration is applied).
 */
export async function searchNews(rawQuery: string, limit = 100): Promise<NewsListItem[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const base = () =>
    supabase
      .from("news_items")
      .select(NEWS_FIELDS)
      .eq("active", true)
      .is("duplicate_of", null)
      .not("body_has_kratom_keyword", "is", false);

  const fts = await base()
    .textSearch("search_tsv", q, { type: "websearch", config: "english" })
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (!fts.error) return (fts.data ?? []) as unknown as NewsListItem[];

  // Fallback: strip PostgREST or()-filter metacharacters, then substring-match
  // the whole corpus across title / summary / lead excerpt.
  const safe = q.replace(/[,()*%\\:]/g, " ").trim();
  if (!safe) return [];
  const { data } = await base()
    .or(`title.ilike.*${safe}*,summary.ilike.*${safe}*,body_extract_excerpt.ilike.*${safe}*`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return (data ?? []) as unknown as NewsListItem[];
}

export async function flagNewsItem(input: { id: string; reason: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("news_items")
    .update({ flagged_by: user.id, flag_reason: input.reason.slice(0, 200) })
    .eq("id", input.id);
  if (error) return { error: error.message };
  revalidatePath("/news");
  return { ok: true };
}

export async function deactivateNewsItem(id: string) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { error: "Admin only." };
  const supabase = await createClient();
  const { error } = await supabase.from("news_items").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/news");
  return { ok: true };
}

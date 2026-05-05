"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";

// All public listings filter to canonicals (duplicate_of IS NULL) so each
// syndicated story shows exactly once. The canonical row exposes
// `duplicate_count` for the "also reported in N other states" badge.
const NEWS_FIELDS =
  "id, state, title, summary, url, source_name, published_at, " +
  "kratom_topic, ai_relevance_score, duplicate_count";

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
  kratom_topic: string | null;
  ai_relevance_score: number | null;
  duplicate_count: number | null;
};

export async function listNewsForState(state: string | null, limit = 20): Promise<NewsListItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("news_items")
    .select(NEWS_FIELDS)
    .eq("active", true)
    .is("duplicate_of", null);

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

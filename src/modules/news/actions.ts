"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCreatorContext } from "@/modules/admin/actions";

export async function listNewsForState(state: string | null, limit = 20) {
  const supabase = await createClient();
  let q = supabase
    .from("news_items")
    .select("id, state, title, summary, url, source_name, published_at, kratom_topic, ai_relevance_score")
    .eq("active", true);

  if (state === null) {
    q = q.is("state", null);
  } else {
    q = q.eq("state", state);
  }

  const { data } = await q
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("ai_relevance_score", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listAllRecentNews(limit = 50) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("news_items")
    .select("id, state, title, summary, url, source_name, published_at, kratom_topic, ai_relevance_score")
    .eq("active", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  return data ?? [];
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

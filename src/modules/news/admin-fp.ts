"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";

export type FPRow = {
  id: string;
  title: string;
  url: string;
  resolved_url: string | null;
  source_name: string | null;
  state: string | null;
  published_at: string | null;
  body_verified_at: string | null;
  body_extract_excerpt: string | null;
  ai_relevance_score: number | null;
};

export type FPStats = {
  total: number;            // all active news_items
  flagged: number;          // body_has_kratom_keyword = false
  passed: number;           // = true
  pending: number;          // null (not yet verified)
  resolvedUrlCount: number; // items with resolved_url set (Phase 2 ready)
  flaggedThisWeek: number;
  topNoisySources: Array<{ source: string; total: number; flagged: number; rate: number }>;
};

/**
 * Quality stats for the FP review page. Reads from news_items
 * directly — small enough table that we can do real-time aggregates
 * without materialized views.
 */
export async function getFPStats(): Promise<FPStats> {
  const sb = await createClient();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [total, flagged, passed, pending, resolved, weekFlagged, sources] = await Promise.all([
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("active", true),
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("active", true).eq("body_has_kratom_keyword", false),
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("active", true).eq("body_has_kratom_keyword", true),
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("active", true).is("body_has_kratom_keyword", null),
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("active", true).not("resolved_url", "is", null),
    sb.from("news_items").select("id", { count: "exact", head: true }).eq("active", true).eq("body_has_kratom_keyword", false).gte("body_verified_at", weekAgo),
    // Per-source aggregate: pull all source_name + body_has_kratom_keyword pairs, aggregate client-side
    sb.from("news_items").select("source_name, body_has_kratom_keyword").eq("active", true).limit(10_000),
  ]);

  const bySource = new Map<string, { total: number; flagged: number }>();
  for (const r of (sources.data ?? []) as Array<{ source_name: string | null; body_has_kratom_keyword: boolean | null }>) {
    const s = r.source_name ?? "(unknown)";
    if (!bySource.has(s)) bySource.set(s, { total: 0, flagged: 0 });
    const ent = bySource.get(s)!;
    ent.total++;
    if (r.body_has_kratom_keyword === false) ent.flagged++;
  }
  const topNoisySources = Array.from(bySource.entries())
    .filter(([, e]) => e.total >= 5) // ignore tiny-sample sources
    .map(([source, e]) => ({ source, total: e.total, flagged: e.flagged, rate: e.flagged / e.total }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 15);

  return {
    total: total.count ?? 0,
    flagged: flagged.count ?? 0,
    passed: passed.count ?? 0,
    pending: pending.count ?? 0,
    resolvedUrlCount: resolved.count ?? 0,
    flaggedThisWeek: weekFlagged.count ?? 0,
    topNoisySources,
  };
}

/**
 * Pagination-friendly list of FP-flagged items. Newest first.
 * Optional search filter against title.
 */
export async function listFlaggedFPs(opts: {
  search?: string;
  offset?: number;
  limit?: number;
}): Promise<{ rows: FPRow[]; hasMore: boolean }> {
  const sb = await createClient();
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;

  let q = sb.from("news_items")
    .select("id, title, url, resolved_url, source_name, state, published_at, body_verified_at, body_extract_excerpt, ai_relevance_score")
    .eq("active", true)
    .eq("body_has_kratom_keyword", false)
    .order("body_verified_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit);

  if (opts.search) {
    q = q.ilike("title", `%${opts.search.slice(0, 80)}%`);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as FPRow[];
  return {
    rows: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

/**
 * Unflag an FP — clear body_has_kratom_keyword back to NULL so the
 * item is visible again. Records to admin_audit_log.
 *
 * This is the "this isn't actually an FP" override. Used when:
 *   - Phase 1 over-flagged a news-roundup
 *   - The classifier picked the wrong column
 *   - Admin reviewed and wants the article surfaced
 *
 * After unflag, the next verifier run could re-flag if the keyword
 * truly isn't anywhere. Admin should also set ai_relevance_score
 * higher if they want the item to appear on /pulse specifically.
 */
export async function unflagFP(id: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const sb = await createClient();
  const { data: item } = await sb.from("news_items")
    .select("id, title, url")
    .eq("id", id)
    .single();
  if (!item) return { error: "Item not found." };

  const { error } = await sb.from("news_items")
    .update({ body_has_kratom_keyword: null, body_verified_at: null })
    .eq("id", id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "news_fp_unflag",
    targetType: "policy_alert",
    targetId: id,
    details: {
      title: item.title?.slice(0, 200),
      url: item.url?.slice(0, 500),
    },
  });

  revalidatePath("/admin/intel-health/false-positives");
  revalidatePath("/news");
  revalidatePath("/pulse");
  return { ok: true };
}

/**
 * Hard-deactivate an FP — sets active=false so it's permanently hidden
 * even if the verifier re-runs. Use for cases where the article is
 * SO clearly off-topic that we don't want it polluting anything ever.
 */
export async function deactivateFP(id: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };

  const sb = await createClient();
  const { data: item } = await sb.from("news_items")
    .select("id, title, url")
    .eq("id", id)
    .single();
  if (!item) return { error: "Item not found." };

  const { error } = await sb.from("news_items").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "news_fp_deactivate",
    targetType: "policy_alert",
    targetId: id,
    details: {
      title: item.title?.slice(0, 200),
      url: item.url?.slice(0, 500),
    },
  });

  revalidatePath("/admin/intel-health/false-positives");
  return { ok: true };
}

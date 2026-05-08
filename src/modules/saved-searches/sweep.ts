import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily saved-search sweep. Runs in cron after bills are synced + enriched.
 * For each active saved search, find bills last_synced_at > the search's
 * last_match_check_at that match the query. Fire one notification per
 * (user, search) summarizing the new matches.
 *
 * Capped per-cron at 200 searches to keep within Vercel function budget.
 * Also caps matches per search to 5 to keep notification body short.
 */
export async function sweepSavedSearches(
  supabase: SupabaseClient,
): Promise<{ checked: number; fired: number; matched: number }> {
  const result = { checked: 0, fired: 0, matched: 0 };

  const { data: searches, error } = await supabase
    .from("user_saved_searches")
    .select("id, user_id, name, query, alert_method, last_match_check_at")
    .eq("active", true)
    .order("last_match_check_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error || !searches) return result;

  result.checked = searches.length;

  for (const s of searches as Array<{
    id: string;
    user_id: string;
    name: string;
    query: { state?: string; relevance?: string; keyword?: string; scope?: string };
    last_match_check_at: string | null;
  }>) {
    // Build the bills query from the saved search criteria
    let q = supabase
      .from("bills")
      .select("id, state, bill_number, title, kratom_relevance, scope, last_synced_at")
      .eq("active", true)
      .order("last_synced_at", { ascending: false })
      .limit(5);

    if (s.last_match_check_at) {
      q = q.gt("last_synced_at", s.last_match_check_at);
    } else {
      // First run — only flag bills synced in the last 24h to avoid
      // flooding the user with their entire historical match set.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      q = q.gt("last_synced_at", since);
    }
    if (s.query.state) q = q.eq("state", s.query.state);
    if (s.query.relevance) q = q.eq("kratom_relevance", s.query.relevance);
    if (s.query.scope) q = q.eq("scope", s.query.scope);
    if (s.query.keyword) {
      q = q.or(`title.ilike.%${s.query.keyword}%,summary.ilike.%${s.query.keyword}%`);
    }

    const { data: matches } = await q;
    const newMatches = matches ?? [];

    if (newMatches.length === 0) {
      // No matches — just bump the check timestamp.
      await supabase
        .from("user_saved_searches")
        .update({ last_match_check_at: new Date().toISOString() })
        .eq("id", s.id);
      continue;
    }

    // Notification body — keep short, link to /bills filtered.
    const titlePreview = newMatches
      .slice(0, 3)
      .map((b: { state: string; bill_number: string }) => `${b.state} ${b.bill_number}`)
      .join(", ");
    const moreCount = newMatches.length > 3 ? newMatches.length - 3 : 0;
    const body =
      `${newMatches.length} new bill${newMatches.length === 1 ? "" : "s"} matched "${s.name}": ${titlePreview}` +
      (moreCount > 0 ? ` and ${moreCount} more` : "");

    await supabase.from("notifications").insert({
      user_id: s.user_id,
      kind: "saved_search_match",
      title: `New matches for: ${s.name}`,
      body,
      link: "/bills",
    });

    // Bump check timestamp + running counter via two-step (read existing
    // first since Postgres-side increment isn't expressible in supabase-js
    // without an RPC; the read is one row by PK so it's cheap).
    const { data: existing } = await supabase
      .from("user_saved_searches")
      .select("total_matches")
      .eq("id", s.id)
      .single();
    await supabase
      .from("user_saved_searches")
      .update({
        last_match_check_at: new Date().toISOString(),
        total_matches: (existing?.total_matches ?? 0) + newMatches.length,
      })
      .eq("id", s.id);

    result.fired++;
    result.matched += newMatches.length;
  }

  return result;
}

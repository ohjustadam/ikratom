"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { FORUM_KEY_RX, type SubMode } from "./engagement-keys";

/**
 * Forum engagement: visit tracking + per-forum subscriptions.
 * Server actions only — pure key helpers (stateKey/communityKey) live
 * in ./engagement-keys.ts since "use server" modules can only export
 * async functions.
 *
 * Visits are best-effort fire-and-forget — never block render. Any
 * failure (e.g. anon user, RLS reject) silently noops.
 */

export type ForumStatRow = {
  forum_key: string;
  thread_count: number;
  post_count: number;
  last_activity: string | null;
  unread_count: number | null;
  sub_mode: SubMode | null;
};

/**
 * One-shot fetch of every forum's aggregate stats + the calling user's
 * unread count + sub mode. Use on the /forum index. Anonymous callers
 * still get thread/post counts; unread + sub_mode are null for them.
 */
export async function fetchForumStatsForIndex(): Promise<Record<string, ForumStatRow>> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("forum_stats_for_index");
  const out: Record<string, ForumStatRow> = {};
  for (const r of (data ?? []) as ForumStatRow[]) {
    out[r.forum_key] = r;
  }
  return out;
}

/**
 * Mark a forum as visited NOW for the calling user. Idempotent — the
 * upsert just updates last_visited_at. Silently noops for anonymous
 * users (they have no row).
 */
export async function recordForumVisit(forumKey: string): Promise<void> {
  if (!FORUM_KEY_RX.test(forumKey)) return;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("forum_visits")
      .upsert(
        { user_id: user.id, forum_key: forumKey, last_visited_at: new Date().toISOString() },
        { onConflict: "user_id,forum_key" },
      );
  } catch {
    // best-effort
  }
}

/**
 * Set / change / clear the calling user's subscription to a forum.
 * Pass mode=null to remove the row (treat as default = "no
 * preference," neither alert nor mute).
 */
export async function setForumSubscription(input: {
  forumKey: string;
  mode: SubMode | null;
}): Promise<{ ok: true } | { error: string }> {
  if (!FORUM_KEY_RX.test(input.forumKey)) return { error: "Invalid forum." };
  if (input.mode !== null && !["alerts", "digest", "mute"].includes(input.mode)) {
    return { error: "Invalid mode." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  if (input.mode === null) {
    const { error } = await supabase
      .from("forum_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("forum_key", input.forumKey);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("forum_subscriptions")
      .upsert(
        { user_id: user.id, forum_key: input.forumKey, mode: input.mode },
        { onConflict: "user_id,forum_key" },
      );
    if (error) return { error: error.message };
  }

  // Forum index reads sub_mode; revalidate so the chip updates.
  revalidatePath("/forum");
  if (input.forumKey.startsWith("state:")) {
    revalidatePath(`/forum/${input.forumKey.slice(6)}`);
  } else if (input.forumKey.startsWith("community:")) {
    // /forum/c/<slug> is keyed by slug, not id — caller is responsible
    // for revalidating its own slug page if it needs to.
  }
  return { ok: true };
}

/**
 * List the calling user's forum subscriptions. Used by the account
 * notifications page to show all opt-ins in one place.
 */
export async function listMyForumSubscriptions(): Promise<
  Array<{ forum_key: string; mode: SubMode; created_at: string }>
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("forum_subscriptions")
    .select("forum_key, mode, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  return (data ?? []) as Array<{ forum_key: string; mode: SubMode; created_at: string }>;
}

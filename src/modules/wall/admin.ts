import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The text of reported wall posts and comments, for the reports queue. A wall
 * may be Friends-only, so a moderator can't always open it; the queue shows
 * the words themselves. Service role, admin pages only.
 */
export async function loadWallExcerpts(
  svc: SupabaseClient,
  targets: { type: string; id: string }[],
): Promise<Map<string, { body: string; wallOwnerId: string | null }>> {
  const out = new Map<string, { body: string; wallOwnerId: string | null }>();
  const postIds = targets.filter((t) => t.type === "wall_post").map((t) => t.id);
  const commentIds = targets.filter((t) => t.type === "wall_comment").map((t) => t.id);
  if (!postIds.length && !commentIds.length) return out;

  const { data: comments } = commentIds.length
    ? await svc.from("wall_comments").select("id, body, post_id").in("id", commentIds)
    : { data: [] };
  const cs = (comments ?? []) as { id: string; body: string; post_id: string }[];
  const { data: posts } = await svc.from("wall_posts").select("id, body, wall_owner_id")
    .in("id", [...new Set([...postIds, ...cs.map((c) => c.post_id)])]);
  const owner = new Map(((posts ?? []) as { id: string; body: string; wall_owner_id: string }[]).map((p) => [p.id, p]));

  for (const id of postIds) {
    const p = owner.get(id);
    if (p) out.set(`wall_post:${id}`, { body: p.body, wallOwnerId: p.wall_owner_id });
  }
  for (const c of cs) out.set(`wall_comment:${c.id}`, { body: c.body, wallOwnerId: owner.get(c.post_id)?.wall_owner_id ?? null });
  return out;
}

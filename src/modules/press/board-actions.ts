"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * A member's own ticks on the /media Top 5 board (migration 0331). Writes go
 * through the member's session, so RLS limits each person to their own rows.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MyTicks = Record<string, { emailed: boolean; commented: boolean }>;

export async function getMyBoardTicks(ids: string[]): Promise<MyTicks> {
  const clean = (Array.isArray(ids) ? ids : []).filter((i) => UUID_RE.test(String(i))).slice(0, 10);
  if (!clean.length) return {};
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return {};
  const { data } = await sb.from("media_board_actions").select("news_item_id, kind").eq("user_id", user.id).in("news_item_id", clean);
  const out: MyTicks = {};
  for (const r of (data ?? []) as { news_item_id: string; kind: string }[]) {
    const t = (out[r.news_item_id] ??= { emailed: false, commented: false });
    if (r.kind === "emailed") t.emailed = true;
    if (r.kind === "commented") t.commented = true;
  }
  return out;
}

export type TickResult = { ok: true; commented: boolean } | { ok: false; reason: "signed_out" | "limit" | "error" };

/** "I left a comment on this story": on, or off again. */
export async function toggleCommented(newsItemId: string, on: boolean): Promise<TickResult> {
  if (!UUID_RE.test(String(newsItemId))) return { ok: false, reason: "error" };
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { ok: false, reason: "signed_out" };
  if (!(await checkRateLimit(`media-board:user:${user.id}`, 30, 3600))) return { ok: false, reason: "limit" };
  const q = on
    ? sb.from("media_board_actions").upsert({ user_id: user.id, news_item_id: newsItemId, kind: "commented" }, { onConflict: "user_id,news_item_id,kind", ignoreDuplicates: true })
    : sb.from("media_board_actions").delete().eq("user_id", user.id).eq("news_item_id", newsItemId).eq("kind", "commented");
  const { error } = await q;
  return error ? { ok: false, reason: "error" } : { ok: true, commented: on };
}

"use server";

import { createAnonClient } from "@/lib/supabase/anon";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { linkVariants } from "@/lib/shared-link";

/**
 * "Do we already have this story, and is there something to do about it?"
 *
 * WHY (PJ, 2026-11-24; owner "take your picks"): a member who shares or
 * pastes an article into iKratom should land on the story and its campaign
 * if we have them, instead of filing a tip we already acted on.
 *
 * Reads public rows only (news_public_read, campaigns_public_read) through
 * the anon client. Signed-in members only, 30 lookups a minute, so the form
 * can look up as they paste without becoming an open URL oracle.
 */
export type LinkMatch = {
  story: { id: string; title: string; source: string | null } | null;
  campaigns: { slug: string; title: string }[];
};

const NONE: LinkMatch = { story: null, campaigns: [] };
type Row = { id: string; title: string; source_name: string | null; duplicate_of: string | null; bill_id: string | null; state: string | null };
const COLS = "id, title, source_name, duplicate_of, bill_id, state";

export async function findStoryByLink(raw: string): Promise<LinkMatch> {
  const variants = linkVariants(String(raw ?? "").slice(0, 1000));
  if (!variants.length) return NONE;

  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NONE;
  if (!(await checkRateLimit(`link-lookup:user:${user.id}`, 30, 60))) return NONE;

  const sb = createAnonClient();
  const [byUrl, byResolved] = await Promise.all([
    sb.from("news_items").select(COLS).in("url", variants).limit(5),
    sb.from("news_items").select(COLS).in("resolved_url", variants).limit(5),
  ]);
  const hits = [...((byUrl.data ?? []) as Row[]), ...((byResolved.data ?? []) as Row[])];
  if (!hits.length) return NONE;

  // Show the canonical story: a syndicated copy points at it with duplicate_of.
  let story: Row | undefined = hits.find((h) => !h.duplicate_of);
  if (!story) {
    const { data } = await sb.from("news_items").select(COLS).eq("id", hits[0].duplicate_of!).maybeSingle();
    story = (data as Row | null) ?? hits[0];
  }

  // Its bill's live campaigns first; failing that, the live campaigns in its state.
  const live = () => sb.from("campaigns").select("slug, title").eq("active", true).order("created_at", { ascending: false }).limit(3);
  let campaigns: { slug: string; title: string }[] = [];
  if (story.bill_id) campaigns = ((await live().eq("bill_id", story.bill_id)).data ?? []) as typeof campaigns;
  if (!campaigns.length && story.state) campaigns = ((await live().eq("state", story.state)).data ?? []) as typeof campaigns;

  return { story: { id: story.id, title: story.title, source: story.source_name }, campaigns };
}

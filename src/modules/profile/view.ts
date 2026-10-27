import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Audience } from "./audience";

/**
 * One profile, as the CURRENT viewer may see it (get_profile_view, 0285).
 * Every section is null when the viewer is not allowed to see it, so a page
 * can render "whatever came back" and never leak by forgetting a check.
 */
export type ProfileView = {
  id: string;
  username: string | null;
  state: string | null;
  is_admin: boolean;
  is_advocate_leader: boolean;
  relationship: "self" | "blocked" | "friends" | "pending_out" | "pending_in" | "none";
  profile_visible: boolean;
  profile_audience: Audience | null;
  can_message: boolean;
  /** /api/media/<id>, only when the viewer may see that photo (0286). */
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  story: string | null;
  interests: string[] | null;
  links: { label: string; url: string }[] | null;
  friend_count: number | null;
  activity_visible: boolean | null;
  thread_count: number | null;
  action_count: number | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE_RE = /^@?[a-z0-9_]{3,30}$/i;

/** `/profile/<uuid>` or `/profile/@handle` (or a bare handle). */
export const loadProfileView = cache(async (param: string): Promise<ProfileView | null> => {
  const key = decodeURIComponent(param ?? "").trim();
  const supabase = await createClient();
  if (UUID_RE.test(key)) {
    const { data } = await supabase.rpc("get_profile_view", { p_id: key });
    return ((data as ProfileView[] | null) ?? [])[0] ?? null;
  }
  if (HANDLE_RE.test(key)) {
    const { data } = await supabase.rpc("get_profile_view_by_username", { p_username: key.replace(/^@/, "").toLowerCase() });
    return ((data as ProfileView[] | null) ?? [])[0] ?? null;
  }
  return null;
});

/** The canonical, shareable profile URL: by handle when there is one. */
export function profileHref(p: { id: string; username: string | null }): string {
  return p.username ? `/profile/@${p.username}` : `/profile/${p.id}`;
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Group home (migration 0284): the welcome checklist's own state and the
 * pinned post. coalition_members has no UPDATE policy (roles must not be
 * self-editable), so a member's own checklist stamps are written with the
 * service role, only after their membership is proven and only on their row.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
type Res = { ok: boolean; error?: string };

async function ownMembership(coalitionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !UUID_RE.test(coalitionId)) return null;
  const { data } = await supabase
    .from("coalition_members").select("role").eq("coalition_id", coalitionId).eq("user_id", user.id).maybeSingle();
  return data ? { supabase, user, role: data.role as "owner" | "admin" | "member" } : null;
}

async function stampOwnRow(coalitionId: string, column: "shared_link_at" | "welcome_done_at"): Promise<Res> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  const me = await ownMembership(coalitionId);
  if (!me) return { ok: false, error: "Only members can do that." };
  if (!(await checkRateLimit(`coalition:home:${me.user.id}`, 30, 3600))) return { ok: false, error: "Slow down a little." };
  const admin = createServiceRoleClient();
  await admin.from("coalition_members").update({ [column]: new Date().toISOString() })
    .eq("coalition_id", coalitionId).eq("user_id", me.user.id).is(column, null);
  const { data: c } = await admin.from("coalitions").select("slug").eq("id", coalitionId).maybeSingle();
  if (c) revalidatePath(`/coalitions/${c.slug}`);
  return { ok: true };
}

/** The member copied or shared the group link: the checklist's "invite one person". */
export async function markGroupLinkShared(coalitionId: string): Promise<Res> {
  return stampOwnRow(coalitionId, "shared_link_at");
}

/** Close the welcome checklist for good. */
export async function finishWelcome(coalitionId: string): Promise<Res> {
  return stampOwnRow(coalitionId, "welcome_done_at");
}

/** Pin one discussion to the top of the board (or unpin it). Organizers only; RLS + a trigger enforce it too. */
export async function pinThread(slug: string, threadId: string, pin: boolean): Promise<Res> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data: c } = await supabase.from("coalitions").select("id").eq("slug", slug).maybeSingle();
  if (!c) return { ok: false, error: "Group not found." };
  const me = await ownMembership(c.id);
  if (!me || (me.role !== "owner" && me.role !== "admin")) return { ok: false, error: "Only the group's organizers can pin posts." };

  // One pinned post at a time, like a group's "featured" slot.
  if (pin) {
    await supabase.from("coalition_threads").update({ pinned_at: null })
      .eq("coalition_id", c.id).not("pinned_at", "is", null).neq("id", threadId);
  }
  const { data, error } = await supabase.from("coalition_threads")
    .update({ pinned_at: pin ? new Date().toISOString() : null })
    .eq("id", threadId).eq("coalition_id", c.id).is("deleted_at", null).select("id");
  if (error || !data || data.length === 0) return { ok: false, error: "Couldn't change that." };
  revalidatePath(`/coalitions/${slug}`);
  revalidatePath(`/coalitions/${slug}/t/${threadId}`);
  return { ok: true };
}

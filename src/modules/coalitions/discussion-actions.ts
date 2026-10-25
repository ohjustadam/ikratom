"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Coalition discussion board (migration 0273). Owner ask 2026-10-21, after a
 * member found her new group page had nowhere to go: "Shouldn't there be a
 * discussion page where I can coordinate with other members?"
 *
 * Writes go through the USER's client, so RLS is what proves membership; the
 * checks here only exist to return a readable error. Notifications use the
 * service role (members can't write each other's notifications) and carry no
 * text from the post beyond its title, and authors appear as @username only.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_TITLE = 140;
const MAX_BODY = 5000;

type Result = { ok: true; id: string } | { ok: false; error: string };

async function memberContext(slug: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to post." } as const;
  const { data: c } = await supabase
    .from("coalitions").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (!c) return { error: "Group not found." } as const;
  const { data: m } = await supabase
    .from("coalition_members").select("role")
    .eq("coalition_id", c.id).eq("user_id", user.id).maybeSingle();
  if (!m) return { error: "Only members of this group can post here." } as const;
  return { supabase, user, coalition: c, isOrganizer: m.role === "owner" || m.role === "admin" } as const;
}

/** Tell the group's other members (or one thread's participants) about a post. */
async function notify(userIds: string[], title: string, body: string, link: string) {
  if (userIds.length === 0) return;
  const admin = createServiceRoleClient();
  await admin.from("notifications").insert(
    userIds.map((user_id) => ({ user_id, kind: "coalition_discussion", title, body, link })),
  ).then(() => {}, () => {}); // a missed notice must never fail the post
}

export async function createCoalitionThread(
  slug: string,
  title: string,
  body: string,
  opts: { pin?: boolean } = {},
): Promise<Result> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  const t = String(title ?? "").trim();
  const b = String(body ?? "").trim();
  if (t.length < 3 || t.length > MAX_TITLE) return { ok: false, error: `Give it a title of 3–${MAX_TITLE} characters.` };
  if (!b || b.length > MAX_BODY) return { ok: false, error: `Write something (up to ${MAX_BODY} characters).` };

  const ctx = await memberContext(slug);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!(await checkRateLimit(`coalition:thread:${ctx.user.id}`, 5, 3600))) {
    return { ok: false, error: "You've started several discussions this hour. Try again a little later." };
  }

  const { data, error } = await ctx.supabase
    .from("coalition_threads")
    .insert({
      coalition_id: ctx.coalition.id, author_id: ctx.user.id, title: t, body: b,
      // An organizer's welcome post goes straight to the top (migration 0284's trigger checks the role).
      ...(opts.pin && ctx.isOrganizer ? { pinned_at: new Date().toISOString() } : {}),
    })
    .select("id").single();
  if (error || !data) return { ok: false, error: "Couldn't post that. Try again." };
  if (opts.pin && ctx.isOrganizer) {
    await ctx.supabase.from("coalition_threads").update({ pinned_at: null })
      .eq("coalition_id", ctx.coalition.id).not("pinned_at", "is", null).neq("id", data.id);
  }

  const { data: others } = await ctx.supabase
    .from("coalition_members").select("user_id")
    .eq("coalition_id", ctx.coalition.id).neq("user_id", ctx.user.id);
  await notify(
    (others ?? []).map((o) => o.user_id),
    `New discussion in ${ctx.coalition.name}`,
    t,
    `/coalitions/${ctx.coalition.slug}/t/${data.id}`,
  );

  revalidatePath(`/coalitions/${slug}`);
  return { ok: true, id: data.id };
}

export async function replyCoalitionThread(slug: string, threadId: string, body: string): Promise<Result> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(threadId)) return { ok: false, error: "Discussion not found." };
  const b = String(body ?? "").trim();
  if (!b || b.length > MAX_BODY) return { ok: false, error: `Write something (up to ${MAX_BODY} characters).` };

  const ctx = await memberContext(slug);
  if ("error" in ctx) return { ok: false, error: ctx.error ?? "Not allowed." };
  if (!(await checkRateLimit(`coalition:reply:${ctx.user.id}`, 30, 3600))) {
    return { ok: false, error: "You're replying very fast. Give it a minute." };
  }

  const { data: thread } = await ctx.supabase
    .from("coalition_threads").select("id, title, author_id")
    .eq("id", threadId).eq("coalition_id", ctx.coalition.id).is("deleted_at", null).maybeSingle();
  if (!thread) return { ok: false, error: "Discussion not found." };

  const { data, error } = await ctx.supabase
    .from("coalition_posts")
    .insert({ thread_id: thread.id, coalition_id: ctx.coalition.id, author_id: ctx.user.id, body: b })
    .select("id").single();
  if (error || !data) return { ok: false, error: "Couldn't post that. Try again." };

  // Everyone already in the conversation, minus the person replying.
  const { data: earlier } = await ctx.supabase
    .from("coalition_posts").select("author_id").eq("thread_id", thread.id).is("deleted_at", null);
  const participants = new Set([thread.author_id, ...(earlier ?? []).map((p) => p.author_id)]);
  participants.delete(ctx.user.id);
  await notify(
    [...participants],
    `New reply in ${ctx.coalition.name}`,
    thread.title,
    `/coalitions/${ctx.coalition.slug}/t/${thread.id}`,
  );

  revalidatePath(`/coalitions/${slug}/t/${thread.id}`);
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true, id: data.id };
}

/** Soft-delete a thread or reply. RLS allows the author and the group's owner/admins. */
export async function removeCoalitionPost(
  slug: string,
  kind: "thread" | "post",
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Not found." };
  const ctx = await memberContext(slug);
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const table = kind === "thread" ? "coalition_threads" : "coalition_posts";
  const { data, error } = await ctx.supabase
    .from(table).update({ deleted_at: new Date().toISOString() })
    .eq("id", id).eq("coalition_id", ctx.coalition.id).select("id");
  // RLS turns "not allowed" into zero rows, not an error, so check the count.
  if (error || !data || data.length === 0) return { ok: false, error: "You can only remove your own posts." };
  revalidatePath(`/coalitions/${slug}`);
  return { ok: true };
}

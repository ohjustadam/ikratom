"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCreatorContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateEdit } from "@/lib/moderation";
import { sellingIssue } from "@/lib/selling";
import {
  DELETED_THREAD_BODY,
  forumRights,
  forumRoleOf,
  isPrivilegedForumRole,
  type ForumRole,
  type ForumViewer,
} from "@/lib/forum-permissions";

/**
 * Editing and deleting forum content. The database refuses these changes from
 * anything but the service role (migration 0317), so every path runs through
 * here: check who is asking, screen the new words, keep the old ones.
 */

type Result = { ok: true; moderationStatus?: string } | { error: string };
type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type Actor = { viewer: ForumViewer & { id: string }; postCount: number };

const ID_RE = /^[0-9a-f-]{36}$/i;

async function actor(): Promise<Actor | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { data: profile } = await createServiceRoleClient()
    .from("profiles")
    .select("is_owner, is_admin, is_advocate_leader, account_locked_at, forum_post_count")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.account_locked_at) return { error: "This account is locked." };

  const moderator = await getCreatorContext({ require: "moderate_forum" });
  return {
    viewer: { id: user.id, role: forumRoleOf(profile), canModerate: moderator.ok },
    postCount: profile?.forum_post_count ?? 0,
  };
}

async function roleOf(sr: ServiceClient, userId: string | null): Promise<ForumRole> {
  if (!userId) return "member";
  const { data } = await sr
    .from("profiles")
    .select("is_owner, is_admin, is_advocate_leader")
    .eq("id", userId)
    .maybeSingle();
  return forumRoleOf(data);
}

async function underEditLimit(userId: string): Promise<boolean> {
  return checkRateLimit(`forum:edit:user:${userId}`, 30, 3600);
}

function refreshThread(state: string | null, threadId: string) {
  revalidatePath(`/forum/${state ?? "national"}/${threadId}`);
  revalidatePath(`/forum/${state ?? "national"}`);
}

/** Screen an author's new words. Returns the fields to save, or why they're refused. */
function screenAuthorEdit(
  text: string,
  currentStatus: string | null,
  me: Actor,
): { patch: Record<string, unknown> } | { error: string } {
  const selling = sellingIssue(text);
  if (selling) return { error: selling };
  const decision = moderateEdit({
    currentStatus,
    body: text,
    authorPostCount: me.postCount,
    isPrivileged: isPrivilegedForumRole(me.viewer),
  });
  const patch: Record<string, unknown> = { moderation_status: decision.status };
  if (decision.status !== "approved") {
    patch.flag_reason = decision.reason;
    patch.auto_flag_signals = decision.signals;
  }
  return { patch };
}

/** Change a reply. An author's edit is screened; a moderator's is labelled and logged. */
export async function editForumPost(input: { postId: string; body: string }): Promise<Result> {
  const me = await actor();
  if ("error" in me) return me;
  const body = String(input.body ?? "").slice(0, 20_000).trim();
  if (!ID_RE.test(input.postId)) return { error: "That post can't be edited." };
  if (!body) return { error: "A post can't be empty." };
  if (!(await underEditLimit(me.viewer.id))) return { error: "You've made a lot of edits. Try again in an hour." };

  const sr = createServiceRoleClient();
  const { data: post } = await sr
    .from("forum_posts")
    .select("id, thread_id, author_id, body, moderation_status, deleted_at")
    .eq("id", input.postId)
    .maybeSingle();
  if (!post || post.deleted_at) return { error: "That post is gone." };
  const { data: thread } = await sr
    .from("forum_threads")
    .select("state, locked, system_generated")
    .eq("id", post.thread_id)
    .maybeSingle();
  if (!thread) return { error: "That post is gone." };

  const rights = forumRights(me.viewer, {
    authorId: post.author_id,
    authorRole: await roleOf(sr, post.author_id),
    isBot: !post.author_id && !!thread.system_generated,
    status: post.moderation_status,
    threadLocked: !!thread.locked,
  });
  if (!rights.edit) return { error: "You can't edit this post." };
  if (body === post.body) return { ok: true };

  const own = post.author_id === me.viewer.id;
  const patch: Record<string, unknown> = { body, edited_at: new Date().toISOString() };
  if (own) {
    const screened = screenAuthorEdit(body, post.moderation_status, me);
    if ("error" in screened) return screened;
    Object.assign(patch, screened.patch);
  } else {
    patch.edited_by_moderator = true;
  }

  const { error: logError } = await sr.from("forum_edits").insert({
    target_type: "post",
    target_id: post.id,
    thread_id: post.thread_id,
    editor_id: me.viewer.id,
    editor_role: own ? "author" : "moderator",
    previous_body: post.body,
  });
  if (logError) return { error: "Could not save that edit." };

  const { error } = await sr.from("forum_posts").update(patch).eq("id", post.id);
  if (error) return { error: "Could not save that edit." };

  if (!own) {
    await recordAdminAction({
      action: "post_edited",
      targetType: "post",
      targetId: post.id,
      details: { author_id: post.author_id },
    });
  }
  refreshThread(thread.state, post.thread_id);
  return { ok: true, moderationStatus: (patch.moderation_status as string | undefined) ?? post.moderation_status };
}

/** Change a thread's title or opening post. Same rules as a reply. */
export async function editForumThread(input: {
  threadId: string;
  title: string;
  body: string;
}): Promise<Result> {
  const me = await actor();
  if ("error" in me) return me;
  const title = String(input.title ?? "").slice(0, 200).trim();
  const body = String(input.body ?? "").slice(0, 20_000).trim() || null;
  if (!ID_RE.test(input.threadId)) return { error: "That thread can't be edited." };
  if (title.length < 4) return { error: "Title must be at least 4 characters." };
  if (!(await underEditLimit(me.viewer.id))) return { error: "You've made a lot of edits. Try again in an hour." };

  const sr = createServiceRoleClient();
  const { data: thread } = await sr
    .from("forum_threads")
    .select("id, state, author_id, title, body, moderation_status, locked, system_generated")
    .eq("id", input.threadId)
    .maybeSingle();
  if (!thread) return { error: "That thread is gone." };

  const rights = forumRights(me.viewer, {
    authorId: thread.author_id,
    authorRole: await roleOf(sr, thread.author_id),
    isBot: !!thread.system_generated,
    status: thread.moderation_status,
    threadLocked: !!thread.locked,
  });
  if (!rights.edit) return { error: "You can't edit this thread." };
  if (title === thread.title && body === thread.body) return { ok: true };

  const own = thread.author_id === me.viewer.id;
  const patch: Record<string, unknown> = { title, body, edited_at: new Date().toISOString() };
  if (own) {
    const screened = screenAuthorEdit(`${title}\n\n${body ?? ""}`, thread.moderation_status, me);
    if ("error" in screened) return screened;
    Object.assign(patch, screened.patch);
  } else {
    patch.edited_by_moderator = true;
  }

  const { error: logError } = await sr.from("forum_edits").insert({
    target_type: "thread",
    target_id: thread.id,
    thread_id: thread.id,
    editor_id: me.viewer.id,
    editor_role: own ? "author" : "moderator",
    previous_title: thread.title,
    previous_body: thread.body,
  });
  if (logError) return { error: "Could not save that edit." };

  const { error } = await sr.from("forum_threads").update(patch).eq("id", thread.id);
  if (error) return { error: "Could not save that edit." };

  if (!own) {
    await recordAdminAction({
      action: "thread_edited",
      targetType: "thread",
      targetId: thread.id,
      details: { author_id: thread.author_id },
    });
  }
  refreshThread(thread.state, thread.id);
  return { ok: true, moderationStatus: (patch.moderation_status as string | undefined) ?? thread.moderation_status };
}

/** Delete your own reply. Replies under it stay, and moderators keep the old text. */
export async function deleteForumPost(input: { postId: string }): Promise<Result> {
  const me = await actor();
  if ("error" in me) return me;
  if (!ID_RE.test(input.postId)) return { error: "That post can't be deleted." };
  if (!(await underEditLimit(me.viewer.id))) return { error: "Too many changes. Try again in an hour." };

  const sr = createServiceRoleClient();
  const { data: post } = await sr
    .from("forum_posts")
    .select("id, thread_id, author_id, body, moderation_status, deleted_at")
    .eq("id", input.postId)
    .maybeSingle();
  if (!post || post.deleted_at) return { error: "That post is already gone." };
  if (post.author_id !== me.viewer.id || post.moderation_status === "removed") {
    return { error: "You can't delete this post." };
  }

  await sr.from("forum_edits").insert({
    target_type: "post",
    target_id: post.id,
    thread_id: post.thread_id,
    action: "delete",
    editor_id: me.viewer.id,
    editor_role: "author",
    previous_body: post.body,
  });
  const now = new Date().toISOString();
  const { error } = await sr.from("forum_posts").update({ deleted_at: now }).eq("id", post.id);
  if (error) return { error: "Could not delete that post." };

  await sr
    .from("forum_post_reports")
    .update({ resolved_at: now, resolution: "author_deleted" })
    .eq("post_id", post.id)
    .is("resolved_at", null);

  const { data: thread } = await sr.from("forum_threads").select("state").eq("id", post.thread_id).maybeSingle();
  refreshThread(thread?.state ?? null, post.thread_id);
  return { ok: true };
}

/**
 * Delete your own thread. Once other people have replied the conversation is
 * theirs too, so the thread stays with your words and your name taken off it.
 */
export async function deleteForumThread(input: { threadId: string }): Promise<Result> {
  const me = await actor();
  if ("error" in me) return me;
  if (!ID_RE.test(input.threadId)) return { error: "That thread can't be deleted." };
  if (!(await underEditLimit(me.viewer.id))) return { error: "Too many changes. Try again in an hour." };

  const sr = createServiceRoleClient();
  const { data: thread } = await sr
    .from("forum_threads")
    .select("id, state, author_id, title, body, moderation_status")
    .eq("id", input.threadId)
    .maybeSingle();
  if (!thread) return { error: "That thread is already gone." };
  if (thread.author_id !== me.viewer.id || thread.moderation_status === "removed") {
    return { error: "You can't delete this thread." };
  }

  const { count: othersReplies } = await sr
    .from("forum_posts")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", thread.id)
    .neq("author_id", me.viewer.id)
    .is("deleted_at", null)
    .neq("moderation_status", "removed");

  await sr.from("forum_edits").insert({
    target_type: "thread",
    target_id: thread.id,
    thread_id: thread.id,
    action: "delete",
    editor_id: me.viewer.id,
    editor_role: "author",
    previous_title: thread.title,
    previous_body: thread.body,
  });

  const now = new Date().toISOString();
  const { error } = await sr
    .from("forum_threads")
    .update(
      (othersReplies ?? 0) > 0
        ? { body: DELETED_THREAD_BODY, author_id: null, edited_at: now }
        : { moderation_status: "removed", flag_reason: "Deleted by the author" },
    )
    .eq("id", thread.id);
  if (error) return { error: "Could not delete that thread." };

  await sr
    .from("forum_post_reports")
    .update({ resolved_at: now, resolution: "author_deleted" })
    .eq("thread_id", thread.id)
    .is("resolved_at", null);

  refreshThread(thread.state, thread.id);
  return { ok: true };
}

/** Lock or pin a thread. Moderators only. */
export async function setThreadFlags(input: {
  threadId: string;
  locked?: boolean;
  pinned?: boolean;
}): Promise<Result> {
  const moderator = await getCreatorContext({ require: "moderate_forum" });
  if (!moderator.ok) return { error: "Moderators only." };
  if (!ID_RE.test(input.threadId)) return { error: "That thread can't be changed." };

  const patch: { locked?: boolean; pinned?: boolean } = {};
  if (typeof input.locked === "boolean") patch.locked = input.locked;
  if (typeof input.pinned === "boolean") patch.pinned = input.pinned;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { data: thread, error } = await createServiceRoleClient()
    .from("forum_threads")
    .update(patch)
    .eq("id", input.threadId)
    .select("state")
    .maybeSingle();
  if (error || !thread) return { error: "Could not change that thread." };

  const action =
    "locked" in patch
      ? patch.locked ? "thread_locked" : "thread_unlocked"
      : patch.pinned ? "thread_pinned" : "thread_unpinned";
  await recordAdminAction({ action, targetType: "thread", targetId: input.threadId });
  refreshThread(thread.state, input.threadId);
  return { ok: true };
}

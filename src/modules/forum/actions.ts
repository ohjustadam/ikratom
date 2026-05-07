"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { moderateNewContent } from "@/lib/moderation";
import { recordAdminAction } from "@/lib/audit";

const VALID_TAGS = ["general", "legislation", "news", "event", "meetup", "market"] as const;

const cap = (s: string, n: number) => s.slice(0, n).trim();

/** Create a new thread. */
export async function createThread(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to post." };

  const title = cap(String(formData.get("title") ?? ""), 200);
  const body = cap(String(formData.get("body") ?? ""), 20_000) || null;
  const stateRaw = String(formData.get("state") ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  const locality = cap(String(formData.get("locality") ?? ""), 120) || null;
  const tagRaw = String(formData.get("tag") ?? "general");
  const tag = (VALID_TAGS as readonly string[]).includes(tagRaw) ? tagRaw : "general";
  const residentsOnly = formData.get("residents_only") === "on";

  if (!title) return { error: "Title is required." };
  if (title.length < 4) return { error: "Title must be at least 4 characters." };

  // Pull author's state + privileges + post count for moderation decision
  const { data: profile } = await supabase
    .from("profiles")
    .select("state, is_admin, is_owner, is_advocate_leader, forum_post_count")
    .eq("id", user.id)
    .single();

  const isPrivileged =
    !!profile?.is_admin || !!profile?.is_owner || !!profile?.is_advocate_leader;

  // Moderate the title + body together
  const decision = moderateNewContent({
    body: `${title}\n\n${body ?? ""}`,
    authorPostCount: profile?.forum_post_count ?? 0,
    isPrivileged,
  });

  const { data: row, error } = await supabase
    .from("forum_threads")
    .insert({
      state,
      locality,
      author_id: user.id,
      author_state: profile?.state ?? null,
      title,
      body,
      tag,
      residents_only: residentsOnly,
      moderation_status: decision.status,
      flag_reason: decision.reason,
      auto_flag_signals: decision.signals,
    })
    .select("id, state")
    .single();

  if (error) return { error: error.message };

  redirect(`/forum/${row.state ?? "national"}/${row.id}`);
}

/** Reply to a thread (or to another reply if parent_post_id is set). */
export async function createPost(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to reply." };

  const threadId = String(formData.get("thread_id") ?? "");
  const parentPostId = String(formData.get("parent_post_id") ?? "") || null;
  const body = cap(String(formData.get("body") ?? ""), 20_000);

  if (!threadId) return { error: "Missing thread." };
  if (!body) return { error: "Reply can't be empty." };

  // Load the thread to enforce residents_only + locked
  const { data: thread } = await supabase
    .from("forum_threads")
    .select("id, state, residents_only, locked")
    .eq("id", threadId)
    .single();
  if (!thread) return { error: "Thread not found." };
  if (thread.locked) return { error: "Thread is locked." };

  // Load author profile + role + post count
  const { data: profile } = await supabase
    .from("profiles")
    .select("state, is_admin, is_owner, is_advocate_leader, is_shop_owner, is_medical_professional, forum_post_count")
    .eq("id", user.id)
    .single();

  if (thread.residents_only && thread.state) {
    const isLocal = profile?.state === thread.state;
    const isPrivileged =
      !!profile?.is_admin || !!profile?.is_owner || !!profile?.is_advocate_leader ||
      !!profile?.is_shop_owner || !!profile?.is_medical_professional;
    if (!isLocal && !isPrivileged) {
      return {
        error: `This thread is for ${thread.state} residents only. Out-of-state replies are limited to advocate leaders, shop owners, and medical professionals.`,
      };
    }
  }

  const isPrivileged =
    !!profile?.is_admin || !!profile?.is_owner || !!profile?.is_advocate_leader;

  const decision = moderateNewContent({
    body,
    authorPostCount: profile?.forum_post_count ?? 0,
    isPrivileged,
  });

  const { error } = await supabase.from("forum_posts").insert({
    thread_id: threadId,
    parent_post_id: parentPostId,
    author_id: user.id,
    author_state: profile?.state ?? null,
    body,
    moderation_status: decision.status,
    flag_reason: decision.reason,
    auto_flag_signals: decision.signals,
  });

  if (error) return { error: error.message };
  revalidatePath(`/forum/${thread.state ?? "national"}/${threadId}`);

  // Tell the user what happened — the UI can show a clear "in review" banner
  return {
    ok: true,
    moderationStatus: decision.status,
    moderationReason: decision.reason,
  };
}

/** Toggle a reaction (upvote / helpful) on a thread or post. */
export async function toggleReaction(input: {
  targetType: "thread" | "post";
  targetId: string;
  reaction: "upvote" | "helpful";
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to react." };

  const { targetType, targetId, reaction } = input;
  if (!["thread", "post"].includes(targetType)) return { error: "Invalid target." };
  if (!["upvote", "helpful"].includes(reaction)) return { error: "Invalid reaction." };

  // Toggle: try delete first, if 0 rows then insert
  const { data: deleted } = await supabase
    .from("forum_reactions")
    .delete()
    .eq("user_id", user.id)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("reaction", reaction)
    .select("id");

  if (deleted && deleted.length > 0) {
    return { ok: true, removed: true };
  }

  const { error } = await supabase.from("forum_reactions").insert({
    user_id: user.id,
    target_type: targetType,
    target_id: targetId,
    reaction,
  });

  if (error) return { error: error.message };
  return { ok: true, removed: false };
}

/** Soft-delete the user's own post (or any post if admin/leader). */
export async function softDeletePost(postId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Look up the post's author so we can tell whether this is a self-delete
  // or moderation action (logged for accountability if so).
  const { data: post } = await supabase
    .from("forum_posts")
    .select("author_id")
    .eq("id", postId)
    .single();

  const { error } = await supabase
    .from("forum_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) return { error: error.message };

  // Audit-log only when an admin/leader removes someone else's post.
  if (post && post.author_id !== user.id) {
    await recordAdminAction({
      action: "post_deleted",
      targetType: "post",
      targetId: postId,
      details: { author_id: post.author_id },
    });
  }

  return { ok: true };
}

// ============================================================
// Moderation actions (admin/leader only)
// ============================================================

const VALID_REPORT_CATEGORIES = [
  "spam", "commercial", "harassment", "off_topic", "misinformation", "other",
] as const;

/** User-submitted report. Sets target moderation_status to user_flagged
 *  (unless it's already in a stronger flag state). */
export async function reportContent(input: {
  targetType: "post" | "thread";
  targetId: string;
  reasonCategory: typeof VALID_REPORT_CATEGORIES[number];
  reason: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to report content." };

  if (!["post", "thread"].includes(input.targetType)) return { error: "Invalid target." };
  if (!VALID_REPORT_CATEGORIES.includes(input.reasonCategory)) return { error: "Invalid category." };
  const reason = (input.reason || "").trim().slice(0, 500);

  // Insert the report
  const insert: Record<string, unknown> = {
    reporter_id: user.id,
    reason: reason || input.reasonCategory,
    reason_category: input.reasonCategory,
  };
  if (input.targetType === "post") insert.post_id = input.targetId;
  else insert.thread_id = input.targetId;

  const { error: reportErr } = await supabase.from("forum_post_reports").insert(insert);
  if (reportErr) return { error: reportErr.message };

  // Promote target to user_flagged unless already in a flag state.
  // (Don't downgrade auto_flagged → user_flagged.)
  const table = input.targetType === "post" ? "forum_posts" : "forum_threads";
  const { data: current } = await supabase
    .from(table)
    .select("moderation_status")
    .eq("id", input.targetId)
    .single();

  if (current && current.moderation_status === "approved") {
    await supabase
      .from(table)
      .update({ moderation_status: "user_flagged" })
      .eq("id", input.targetId);
  }

  return { ok: true };
}

/** Approve a flagged post or thread. Admin/leader only. */
export async function approveContent(input: {
  targetType: "post" | "thread";
  targetId: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin && !profile?.is_owner && !profile?.is_advocate_leader) {
    return { error: "Moderators only." };
  }

  const table = input.targetType === "post" ? "forum_posts" : "forum_threads";
  const { error } = await supabase
    .from(table)
    .update({
      moderation_status: "approved",
      flag_reason: null,
      auto_flag_signals: null,
    })
    .eq("id", input.targetId);
  if (error) return { error: error.message };

  // Resolve any open reports
  const reportFilter = input.targetType === "post" ? "post_id" : "thread_id";
  await supabase
    .from("forum_post_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "approved" })
    .eq(reportFilter, input.targetId)
    .is("resolved_at", null);

  await recordAdminAction({
    action: `${input.targetType}_approved`,
    targetType: input.targetType,
    targetId: input.targetId,
  });

  revalidatePath("/admin/forum");
  return { ok: true };
}

/** Remove (hide) a post or thread. Admin/leader only. */
export async function removeContent(input: {
  targetType: "post" | "thread";
  targetId: string;
  reason?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin && !profile?.is_owner && !profile?.is_advocate_leader) {
    return { error: "Moderators only." };
  }

  const table = input.targetType === "post" ? "forum_posts" : "forum_threads";
  const reason = (input.reason || "Removed by moderator").slice(0, 500);
  const { error } = await supabase
    .from(table)
    .update({
      moderation_status: "removed",
      flag_reason: reason,
    })
    .eq("id", input.targetId);
  if (error) return { error: error.message };

  // Resolve any open reports
  const reportFilter = input.targetType === "post" ? "post_id" : "thread_id";
  await supabase
    .from("forum_post_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "removed" })
    .eq(reportFilter, input.targetId)
    .is("resolved_at", null);

  await recordAdminAction({
    action: `${input.targetType}_removed`,
    targetType: input.targetType,
    targetId: input.targetId,
    details: { reason },
  });

  revalidatePath("/admin/forum");
  return { ok: true };
}

/** Bulk approve N items at once. Admin/leader only. */
export async function bulkApproveContent(input: {
  posts?: string[];
  threads?: string[];
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin && !profile?.is_owner && !profile?.is_advocate_leader) {
    return { error: "Moderators only." };
  }

  const postIds = (input.posts ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  const threadIds = (input.threads ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);

  let approved = 0;
  if (postIds.length > 0) {
    const { error } = await supabase
      .from("forum_posts")
      .update({ moderation_status: "approved", flag_reason: null, auto_flag_signals: null })
      .in("id", postIds);
    if (!error) approved += postIds.length;
    await supabase
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "approved" })
      .in("post_id", postIds)
      .is("resolved_at", null);
  }
  if (threadIds.length > 0) {
    const { error } = await supabase
      .from("forum_threads")
      .update({ moderation_status: "approved", flag_reason: null, auto_flag_signals: null })
      .in("id", threadIds);
    if (!error) approved += threadIds.length;
    await supabase
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "approved" })
      .in("thread_id", threadIds)
      .is("resolved_at", null);
  }

  await recordAdminAction({
    action: "bulk_approve",
    targetType: "post",
    details: { posts: postIds.length, threads: threadIds.length },
  });

  revalidatePath("/admin/forum");
  return { ok: true, count: approved };
}

/** Bulk remove N items at once. Admin/leader only. */
export async function bulkRemoveContent(input: {
  posts?: string[];
  threads?: string[];
  reason?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin && !profile?.is_owner && !profile?.is_advocate_leader) {
    return { error: "Moderators only." };
  }

  const postIds = (input.posts ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  const threadIds = (input.threads ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  const reason = (input.reason || "Bulk removal").slice(0, 500);

  let removed = 0;
  if (postIds.length > 0) {
    const { error } = await supabase
      .from("forum_posts")
      .update({ moderation_status: "removed", flag_reason: reason })
      .in("id", postIds);
    if (!error) removed += postIds.length;
    await supabase
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "removed" })
      .in("post_id", postIds)
      .is("resolved_at", null);
  }
  if (threadIds.length > 0) {
    const { error } = await supabase
      .from("forum_threads")
      .update({ moderation_status: "removed", flag_reason: reason })
      .in("id", threadIds);
    if (!error) removed += threadIds.length;
    await supabase
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id, resolution: "removed" })
      .in("thread_id", threadIds)
      .is("resolved_at", null);
  }

  await recordAdminAction({
    action: "bulk_remove",
    targetType: "post",
    details: { posts: postIds.length, threads: threadIds.length, reason },
  });

  revalidatePath("/admin/forum");
  return { ok: true, count: removed };
}

/** Count of items needing review. Admin/leader only. */
export async function moderationQueueCount(): Promise<number> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin && !profile?.is_owner && !profile?.is_advocate_leader) return 0;

  const flagged = ["pending", "auto_flagged", "user_flagged"];
  const [posts, threads] = await Promise.all([
    supabase.from("forum_posts").select("id", { count: "exact", head: true }).in("moderation_status", flagged),
    supabase.from("forum_threads").select("id", { count: "exact", head: true }).in("moderation_status", flagged),
  ]);
  return (posts.count ?? 0) + (threads.count ?? 0);
}

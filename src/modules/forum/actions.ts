"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCreatorContext } from "@/modules/admin/actions";
import { forumRights, forumRoleOf, isNewForumAccount, isSamePost } from "@/lib/forum-permissions";
import { moderateNewContent } from "@/lib/moderation";
import { sellingIssue } from "@/lib/selling";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const VALID_TAGS = ["general", "legislation", "news", "event", "meetup", "market"] as const;

const cap = (s: string, n: number) => s.slice(0, n).trim();

/**
 * The spam checks every new thread and reply goes through: a locked account
 * can't post, an account under three days old gets a small allowance, and
 * nobody can post the same words twice in ten minutes. Returns why it's refused.
 */
async function postingBlock(input: {
  userId: string;
  kind: "thread" | "post";
  text: string;
  profile: { created_at?: string | null; account_locked_at?: string | null } | null;
  isPrivileged: boolean;
}): Promise<string | null> {
  const { userId, kind, text, profile, isPrivileged } = input;
  if (profile?.account_locked_at) return "This account is locked.";
  if (isPrivileged) return null;

  if (isNewForumAccount(profile?.created_at)) {
    const allowed =
      kind === "thread"
        ? await checkRateLimit(`forum:new:thread:${userId}`, 3, 86_400)
        : await checkRateLimit(`forum:new:post:${userId}`, 10, 3600);
    if (!allowed) return "New accounts can only post a little at first. Try again later.";
  }

  const sr = createServiceRoleClient();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } =
    kind === "thread"
      ? await sr
          .from("forum_threads")
          .select("title, body")
          .eq("author_id", userId)
          .gte("created_at", since)
          .limit(10)
      : await sr
          .from("forum_posts")
          .select("body")
          .eq("author_id", userId)
          .gte("created_at", since)
          .limit(20);
  const repeat = ((recent ?? []) as { title?: string; body: string | null }[]).some((r) =>
    isSamePost(kind === "thread" ? `${r.title}\n\n${r.body ?? ""}` : (r.body ?? ""), text),
  );
  return repeat ? "You just posted that. Give it a few minutes." : null;
}

/** Create a new thread. */
export async function createThread(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to post." };

  // Rate-limit: 10 threads/hour/user, 30 threads/hour/IP. Spam-account
  // creating dozens of stub threads would otherwise be cheap.
  const ip = await getClientIp();
  if (!(await checkRateLimit(`forum:thread:user:${user.id}`, 10, 3600))) {
    return { error: "You've created a lot of threads recently. Try again in an hour." };
  }
  if (!(await checkRateLimit(`forum:thread:ip:${ip}`, 30, 3600))) {
    return { error: "Too many new threads from this network. Try again later." };
  }

  const title = cap(String(formData.get("title") ?? ""), 200);
  const body = cap(String(formData.get("body") ?? ""), 20_000) || null;
  const stateRaw = String(formData.get("state") ?? "").trim().toUpperCase();
  const state = /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : null;
  const locality = cap(String(formData.get("locality") ?? ""), 120) || null;
  const tagRaw = String(formData.get("tag") ?? "general");
  const tag = (VALID_TAGS as readonly string[]).includes(tagRaw) ? tagRaw : "general";
  const residentsOnly = formData.get("residents_only") === "on";
  // Optional community tag — must resolve to an active community.
  // RLS already hides archived rows, so a stale id from a cached form
  // just falls through to null (thread posts un-categorized) instead
  // of erroring.
  const communityIdRaw = String(formData.get("community_id") ?? "").trim();
  let communityId: string | null = null;
  if (/^[0-9a-f-]{36}$/i.test(communityIdRaw)) {
    const { data: community } = await supabase
      .from("forum_communities")
      .select("id")
      .eq("id", communityIdRaw)
      .eq("is_active", true)
      .single();
    if (community) communityId = community.id;
  }

  if (!title) return { error: "Title is required." };
  if (title.length < 4) return { error: "Title must be at least 4 characters." };

  const selling = sellingIssue(`${title}

${body ?? ""}`);
  if (selling) return { error: selling };

  // Pull author's state + privileges + post count for moderation decision
  const { data: profile } = await supabase
    .from("profiles")
    .select("state, is_admin, is_owner, is_advocate_leader, forum_post_count, created_at, account_locked_at")
    .eq("id", user.id)
    .single();

  const isPrivileged =
    !!profile?.is_admin || !!profile?.is_owner || !!profile?.is_advocate_leader;

  const blocked = await postingBlock({
    userId: user.id,
    kind: "thread",
    text: `${title}\n\n${body ?? ""}`,
    profile,
    isPrivileged,
  });
  if (blocked) return { error: blocked };

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
      community_id: communityId,
      residents_only: residentsOnly,
      moderation_status: decision.status,
      flag_reason: decision.reason,
      auto_flag_signals: decision.signals,
    })
    .select("id, state")
    .single();

  if (error) return { error: error.message };

  // Fan out alerts to forum_subscriptions with mode='alerts' for the
  // thread's state and (optionally) community. mode='digest' is left
  // for the daily digest cron to pick up; mode='mute' is excluded.
  // Best-effort — never blocks the redirect.
  if (decision.status === "approved" || !decision.status) {
    void notifyForumSubscribers({
      threadId: row.id,
      threadTitle: title,
      threadState: row.state ?? null,
      communityId,
      authorId: user.id,
    });
  }

  redirect(`/forum/${row.state ?? "national"}/${row.id}`);
}

/**
 * Notify subscribers of a state forum and/or community when a new
 * approved thread lands. Skips the author. Auto-flagged threads are
 * NOT fanned out — wait until a mod approves so we don't blast
 * spam-detected content to subscribers.
 */
async function notifyForumSubscribers(input: {
  threadId: string;
  threadTitle: string;
  threadState: string | null;
  communityId: string | null;
  authorId: string;
}) {
  try {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    const sr = createServiceRoleClient();
    const keys: string[] = [];
    if (input.threadState) keys.push(`state:${input.threadState}`);
    if (input.communityId) keys.push(`community:${input.communityId}`);
    if (keys.length === 0) return;

    const { data: subs } = await sr
      .from("forum_subscriptions")
      .select("user_id, forum_key, mode")
      .in("forum_key", keys)
      .eq("mode", "alerts");
    if (!subs || subs.length === 0) return;

    // Dedupe — a user subscribed to BOTH the state and the community
    // shouldn't get two notifs for the same thread.
    const recipients = new Set<string>();
    for (const s of subs as Array<{ user_id: string }>) {
      if (s.user_id !== input.authorId) recipients.add(s.user_id);
    }
    if (recipients.size === 0) return;

    const link = input.threadState
      ? `/forum/${input.threadState}/${input.threadId}`
      : `/forum`;
    const titleClipped = input.threadTitle.slice(0, 80);

    await sr.from("notifications").insert(
      Array.from(recipients).map((uid) => ({
        user_id: uid,
        kind: "forum_new_thread",
        title: "New forum thread",
        body: titleClipped,
        link,
      })),
    );
  } catch {
    // best-effort
  }
}

/** Reply to a thread (or to another reply if parent_post_id is set). */
export async function createPost(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to reply." };

  // Rate-limit: 30 posts/hour/user, 100/hour/IP. Looser than threads
  // because replies are the normal mode of conversation, but still
  // caps an account-takeover from auto-replying to everything.
  const ip = await getClientIp();
  if (!(await checkRateLimit(`forum:post:user:${user.id}`, 30, 3600))) {
    return { error: "You've replied a lot recently. Take a breather and try again in an hour." };
  }
  if (!(await checkRateLimit(`forum:post:ip:${ip}`, 100, 3600))) {
    return { error: "Too many replies from this network. Try again later." };
  }

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
    .select("state, is_admin, is_owner, is_advocate_leader, is_shop_owner, is_medical_professional, forum_post_count, created_at, account_locked_at")
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

  const selling = sellingIssue(body);
  if (selling) return { error: selling };

  const isPrivileged =
    !!profile?.is_admin || !!profile?.is_owner || !!profile?.is_advocate_leader;

  const blocked = await postingBlock({ userId: user.id, kind: "post", text: body, profile, isPrivileged });
  if (blocked) return { error: blocked };

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

// ============================================================
// Moderation actions (admin/leader only)
// ============================================================

const VALID_REPORT_CATEGORIES = [
  "spam", "commercial", "harassment", "off_topic", "misinformation", "other",
] as const;

/**
 * A member's report. It always reaches the moderators. The post itself hides
 * only at three reports from accounts at least a week old, or staff, the same
 * rule as photos and wall posts (0307), so one member or a burst of new
 * accounts can't silence someone.
 */
export async function reportContent(input: {
  targetType: "post" | "thread";
  targetId: string;
  reasonCategory: typeof VALID_REPORT_CATEGORIES[number];
  reason: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to report content." };

  // Rate-limit: 20 reports/hour/user. Spam-reporters can swamp the
  // moderation queue with bogus reports and drown out real ones.
  if (!(await checkRateLimit(`forum:report:user:${user.id}`, 20, 3600))) {
    return { error: "You've reported a lot recently. If you're seeing real abuse, email support@ikratom.org." };
  }

  if (!["post", "thread"].includes(input.targetType)) return { error: "Invalid target." };
  if (!VALID_REPORT_CATEGORIES.includes(input.reasonCategory)) return { error: "Invalid category." };
  const reason = (input.reason || "").trim().slice(0, 500);

  const table = input.targetType === "post" ? "forum_posts" : "forum_threads";
  const filter = input.targetType === "post" ? "post_id" : "thread_id";
  const sr = createServiceRoleClient();

  const { data: target } = await sr
    .from(table)
    .select("author_id, moderation_status")
    .eq("id", input.targetId)
    .maybeSingle();
  if (!target) return { error: "That's already gone." };
  if (target.author_id === user.id) return { error: "You can't report your own post." };

  const { data: already } = await sr
    .from("forum_post_reports")
    .select("id")
    .eq(filter, input.targetId)
    .eq("reporter_id", user.id)
    .is("resolved_at", null)
    .limit(1);
  if (already && already.length > 0) return { ok: true };

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

  if (target.moderation_status !== "approved") return { ok: true };

  const { data: open } = await sr
    .from("forum_post_reports")
    .select("reporter_id")
    .eq(filter, input.targetId)
    .is("resolved_at", null);
  const reporters = [...new Set((open ?? []).map((r) => r.reporter_id as string))];
  if (reporters.length < 3) return { ok: true };

  const { data: rows } = await sr
    .from("profiles")
    .select("created_at, is_admin, is_owner, is_advocate_leader")
    .in("id", reporters);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const established = (rows ?? []).filter(
    (p) =>
      p.is_admin || p.is_owner || p.is_advocate_leader ||
      (p.created_at && new Date(p.created_at).getTime() <= weekAgo),
  );
  if (established.length >= 3) {
    await sr.from(table).update({ moderation_status: "user_flagged" }).eq("id", input.targetId);
  }
  return { ok: true };
}

/** Of these items, the ones this moderator outranks the author of. */
async function removableIds(
  sr: ReturnType<typeof createServiceRoleClient>,
  moderator: { userId: string; isOwner: boolean; isAdmin: boolean; isLeader: boolean },
  targetType: "post" | "thread",
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data: rows } = await sr
    .from(targetType === "post" ? "forum_posts" : "forum_threads")
    .select(targetType === "post" ? "id, author_id" : "id, author_id, system_generated")
    .in("id", ids);
  const items = (rows ?? []) as unknown as { id: string; author_id: string | null; system_generated?: boolean }[];
  const authorIds = [...new Set(items.map((r) => r.author_id).filter((x): x is string => !!x))];
  const { data: authors } = authorIds.length
    ? await sr.from("profiles").select("id, is_owner, is_admin, is_advocate_leader").in("id", authorIds)
    : { data: [] };
  const roles = new Map((authors ?? []).map((a) => [a.id as string, forumRoleOf(a)]));
  const viewer = {
    id: moderator.userId,
    canModerate: true,
    role: forumRoleOf({
      is_owner: moderator.isOwner,
      is_admin: moderator.isAdmin,
      is_advocate_leader: moderator.isLeader,
    }),
  };
  return items
    .filter(
      (r) =>
        forumRights(viewer, {
          authorId: r.author_id,
          authorRole: (r.author_id && roles.get(r.author_id)) || "member",
          isBot: targetType === "thread" ? !!r.system_generated : !r.author_id,
          threadLocked: false,
        }).remove,
    )
    .map((r) => r.id);
}

/** Approve a flagged post or thread. Admin/leader only. */
export async function approveContent(input: {
  targetType: "post" | "thread";
  targetId: string;
}) {
  const moderator = await getCreatorContext({ require: "moderate_forum" });
  if (!moderator.ok) return { error: "Moderators only." };
  const sr = createServiceRoleClient();

  const table = input.targetType === "post" ? "forum_posts" : "forum_threads";
  const { error } = await sr
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
  await sr
    .from("forum_post_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: moderator.userId, resolution: "approved" })
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
  const moderator = await getCreatorContext({ require: "moderate_forum" });
  if (!moderator.ok) return { error: "Moderators only." };
  const sr = createServiceRoleClient();

  const allowed = await removableIds(sr, moderator, input.targetType, [input.targetId]);
  if (allowed.length === 0) return { error: "That's for someone above you to decide." };

  const table = input.targetType === "post" ? "forum_posts" : "forum_threads";
  const reason = (input.reason || "Removed by moderator").slice(0, 500);
  const { error } = await sr
    .from(table)
    .update({
      moderation_status: "removed",
      flag_reason: reason,
    })
    .eq("id", input.targetId);
  if (error) return { error: error.message };

  // Resolve any open reports
  const reportFilter = input.targetType === "post" ? "post_id" : "thread_id";
  await sr
    .from("forum_post_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: moderator.userId, resolution: "removed" })
    .eq(reportFilter, input.targetId)
    .is("resolved_at", null);

  await recordAdminAction({
    action: `${input.targetType}_removed`,
    targetType: input.targetType,
    targetId: input.targetId,
    details: { reason },
  });

  revalidatePath("/admin/forum");
  revalidatePath("/forum");
  return { ok: true };
}

/** Bulk approve N items at once. Admin/leader only. */
export async function bulkApproveContent(input: {
  posts?: string[];
  threads?: string[];
}) {
  const moderator = await getCreatorContext({ require: "moderate_forum" });
  if (!moderator.ok) return { error: "Moderators only." };
  const sr = createServiceRoleClient();

  const postIds = (input.posts ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  const threadIds = (input.threads ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);

  let approved = 0;
  if (postIds.length > 0) {
    const { error } = await sr
      .from("forum_posts")
      .update({ moderation_status: "approved", flag_reason: null, auto_flag_signals: null })
      .in("id", postIds);
    if (!error) approved += postIds.length;
    await sr
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: moderator.userId, resolution: "approved" })
      .in("post_id", postIds)
      .is("resolved_at", null);
  }
  if (threadIds.length > 0) {
    const { error } = await sr
      .from("forum_threads")
      .update({ moderation_status: "approved", flag_reason: null, auto_flag_signals: null })
      .in("id", threadIds);
    if (!error) approved += threadIds.length;
    await sr
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: moderator.userId, resolution: "approved" })
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
  const moderator = await getCreatorContext({ require: "moderate_forum" });
  if (!moderator.ok) return { error: "Moderators only." };
  const sr = createServiceRoleClient();

  const postIds = await removableIds(
    sr,
    moderator,
    "post",
    (input.posts ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200),
  );
  const threadIds = await removableIds(
    sr,
    moderator,
    "thread",
    (input.threads ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200),
  );
  const reason = (input.reason || "Bulk removal").slice(0, 500);

  let removed = 0;
  if (postIds.length > 0) {
    const { error } = await sr
      .from("forum_posts")
      .update({ moderation_status: "removed", flag_reason: reason })
      .in("id", postIds);
    if (!error) removed += postIds.length;
    await sr
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: moderator.userId, resolution: "removed" })
      .in("post_id", postIds)
      .is("resolved_at", null);
  }
  if (threadIds.length > 0) {
    const { error } = await sr
      .from("forum_threads")
      .update({ moderation_status: "removed", flag_reason: reason })
      .in("id", threadIds);
    if (!error) removed += threadIds.length;
    await sr
      .from("forum_post_reports")
      .update({ resolved_at: new Date().toISOString(), resolved_by: moderator.userId, resolution: "removed" })
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
  const moderator = await getCreatorContext({ require: "moderate_forum" });
  if (!moderator.ok) return 0;

  const sr = createServiceRoleClient();
  const flagged = ["pending", "auto_flagged", "user_flagged"];
  const [posts, threads] = await Promise.all([
    sr.from("forum_posts").select("id", { count: "exact", head: true }).in("moderation_status", flagged),
    sr.from("forum_threads").select("id", { count: "exact", head: true }).in("moderation_status", flagged),
  ]);
  return (posts.count ?? 0) + (threads.count ?? 0);
}

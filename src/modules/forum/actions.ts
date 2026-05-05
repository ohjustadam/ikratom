"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  // Pull author's state for the badge
  const { data: profile } = await supabase
    .from("profiles")
    .select("state")
    .eq("id", user.id)
    .single();

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

  // Load author profile + role for the badge + residents_only check
  const { data: profile } = await supabase
    .from("profiles")
    .select("state, is_admin, is_owner, is_advocate_leader, is_shop_owner, is_medical_professional")
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

  const { error } = await supabase.from("forum_posts").insert({
    thread_id: threadId,
    parent_post_id: parentPostId,
    author_id: user.id,
    author_state: profile?.state ?? null,
    body,
  });

  if (error) return { error: error.message };
  revalidatePath(`/forum/${thread.state ?? "national"}/${threadId}`);
  return { ok: true };
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

  const { error } = await supabase
    .from("forum_posts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) return { error: error.message };
  return { ok: true };
}

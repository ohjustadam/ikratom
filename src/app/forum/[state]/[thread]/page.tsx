import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TAG_COLORS, TAG_LABELS, type ForumTag } from "@/modules/forum/types";
import { ThreadView } from "./ThreadView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ thread: string }>;
}) {
  const { thread } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("forum_threads")
    .select("title")
    .eq("id", thread)
    .single();
  return { title: data?.title ?? "Thread" };
}

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ state: string; thread: string }>;
}) {
  const { state: rawState, thread: threadId } = await params;
  const state = rawState.toUpperCase();
  const supabase = await createClient();

  // Fetch thread
  const { data: thread } = await supabase
    .from("forum_threads")
    .select("id, state, locality, author_id, author_state, title, body, tag, residents_only, pinned, locked, post_count, upvote_count, helpful_count, last_activity_at, created_at")
    .eq("id", threadId)
    .single();
  if (!thread) notFound();

  // Fetch posts
  const { data: posts } = await supabase
    .from("forum_posts")
    .select("id, thread_id, parent_post_id, author_id, author_state, body, upvote_count, helpful_count, deleted_at, created_at")
    .eq("thread_id", threadId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  // Fetch author display names (from profiles for everyone involved)
  const userIds = new Set<string>();
  if (thread.author_id) userIds.add(thread.author_id);
  for (const p of posts ?? []) if (p.author_id) userIds.add(p.author_id);

  const { data: authorRows } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", Array.from(userIds));

  const authorNames: Record<string, string> = {};
  for (const r of authorRows ?? []) {
    authorNames[r.id] = r.full_name ?? "Member";
  }

  // Current user info for actions
  const { data: { user } } = await supabase.auth.getUser();
  let userState: string | null = null;
  let userIsCreator = false;
  let userReactions: { target_type: string; target_id: string; reaction: string }[] = [];

  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state, is_admin, is_owner, is_advocate_leader, is_shop_owner, is_medical_professional")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;
    userIsCreator = !!(prof?.is_admin || prof?.is_owner || prof?.is_advocate_leader);

    // Pull this user's reactions for everything in the thread
    const targetIds = [thread.id, ...(posts ?? []).map((p) => p.id)];
    const { data: reacts } = await supabase
      .from("forum_reactions")
      .select("target_type, target_id, reaction")
      .eq("user_id", user.id)
      .in("target_id", targetIds);
    userReactions = reacts ?? [];
  }

  // Check residents-only eligibility for replying
  let canReply = !!user && !thread.locked;
  let replyBlockReason: string | null = null;
  if (user && thread.residents_only && thread.state) {
    const isLocal = userState === thread.state;
    const { data: prof2 } = await supabase
      .from("profiles")
      .select("is_admin, is_owner, is_advocate_leader, is_shop_owner, is_medical_professional")
      .eq("id", user.id)
      .single();
    const isPrivileged =
      !!prof2?.is_admin || !!prof2?.is_owner || !!prof2?.is_advocate_leader ||
      !!prof2?.is_shop_owner || !!prof2?.is_medical_professional;
    if (!isLocal && !isPrivileged) {
      canReply = false;
      replyBlockReason = `This thread is for ${thread.state} residents only. Out-of-state replies are limited to advocate leaders, shop owners, and medical professionals.`;
    }
  }
  if (thread.locked) {
    canReply = false;
    replyBlockReason = "This thread is locked.";
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a
        href={`/forum/${state}`}
        className="text-xs text-zinc-500 hover:text-emerald-400"
      >
        ← {state} forum
      </a>

      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold ${TAG_COLORS[thread.tag as ForumTag] ?? "bg-zinc-900 text-zinc-300"}`}
          >
            {TAG_LABELS[thread.tag as ForumTag] ?? thread.tag}
          </span>
          {thread.locality && (
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
              📍 {thread.locality}
            </span>
          )}
          {thread.residents_only && (
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">
              🔒 {state}-only replies
            </span>
          )}
          {thread.locked && (
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">
              Locked
            </span>
          )}
          {thread.author_state && thread.author_state !== state && (
            <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-purple-300">
              From {thread.author_state}
            </span>
          )}
        </div>
        <h1 className="mt-3 text-2xl font-bold sm:text-3xl">{thread.title}</h1>
        <p className="mt-1 text-xs text-zinc-500">
          {thread.author_id ? (
            <a href={`/profile/${thread.author_id}`} className="text-zinc-300 hover:text-emerald-400">
              {authorNames[thread.author_id] ?? "Member"}
            </a>
          ) : (
            <span>Member</span>
          )}
          {" · "}
          {new Date(thread.created_at).toLocaleString()}
        </p>
      </header>

      <ThreadView
        thread={thread}
        posts={posts ?? []}
        authorNames={authorNames}
        threadState={state}
        currentUserId={user?.id ?? null}
        canReply={canReply}
        replyBlockReason={replyBlockReason}
        userIsCreator={userIsCreator}
        userReactions={userReactions}
      />
    </div>
  );
}

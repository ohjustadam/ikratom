"use client";

import { useEffect, useState, useTransition } from "react";
import { publicHandle } from "@/lib/public-handle";
import { useRouter } from "next/navigation";
import { createPost, toggleReaction } from "@/modules/forum/actions";
import type { PostRow, ThreadRow } from "@/modules/forum/types";
import { Markdown } from "@/components/Markdown";
import { ReportButton } from "@/modules/forum/components/ReportButton";
import { createClient } from "@/lib/supabase/client";

type ReactionRow = { target_type: string; target_id: string; reaction: string };

export function ThreadView({
  thread,
  posts,
  authorNames,
  threadState,
  currentUserId,
  canReply,
  replyBlockReason,
  userIsCreator,
  userReactions: initialReactions,
}: {
  thread: ThreadRow;
  posts: PostRow[];
  authorNames: Record<string, string>;
  threadState: string;
  currentUserId: string | null;
  canReply: boolean;
  replyBlockReason: string | null;
  userIsCreator: boolean;
  userReactions: ReactionRow[];
}) {
  const router = useRouter();
  const [reactions, setReactions] = useState<ReactionRow[]>(initialReactions);
  const [, startTransition] = useTransition();
  // Live posts list — appends new replies via Supabase Realtime
  const [livePosts, setLivePosts] = useState<PostRow[]>(posts);
  const [authorNamesLocal, setAuthorNamesLocal] = useState<Record<string, string>>(authorNames);

  // Subscribe to new posts on this thread
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`thread:${thread.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "forum_posts",
          filter: `thread_id=eq.${thread.id}`,
        },
        async (payload) => {
          const newPost = payload.new as PostRow;
          setLivePosts((prev) => {
            if (prev.some((p) => p.id === newPost.id)) return prev;
            return [...prev, newPost];
          });
          // Fetch author display name lazily
          if (newPost.author_id && !authorNamesLocal[newPost.author_id]) {
            const { data } = await supabase.rpc("get_public_profile", { p_id: newPost.author_id });
            const name = publicHandle(data?.[0]);
            setAuthorNamesLocal((prev) => ({ ...prev, [newPost.author_id!]: name }));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [thread.id, authorNamesLocal]);

  function hasReaction(type: "thread" | "post", id: string, reaction: "upvote" | "helpful") {
    return reactions.some(
      (r) => r.target_type === type && r.target_id === id && r.reaction === reaction
    );
  }

  function react(type: "thread" | "post", id: string, reaction: "upvote" | "helpful") {
    const has = hasReaction(type, id, reaction);
    // Optimistic update
    if (has) {
      setReactions((s) =>
        s.filter((r) => !(r.target_type === type && r.target_id === id && r.reaction === reaction))
      );
    } else {
      setReactions((s) => [...s, { target_type: type, target_id: id, reaction }]);
    }
    startTransition(async () => {
      await toggleReaction({ targetType: type, targetId: id, reaction });
      router.refresh();
    });
  }

  // Top-level posts vs replies — sourced from live state (initialPosts + realtime appends).
  // Filter out: self-deletes, mod removals (RLS already handles non-author non-mod
  // visibility, but a fresh realtime append could include a removed row from the
  // author's own session).
  const visiblePosts = livePosts.filter((p) => {
    if (p.deleted_at) return false;
    if (p.moderation_status === "removed") return false;
    return true;
  });
  const topLevel = visiblePosts.filter((p) => !p.parent_post_id);
  const repliesByParent = new Map<string, PostRow[]>();
  for (const p of visiblePosts) {
    if (p.parent_post_id) {
      if (!repliesByParent.has(p.parent_post_id)) repliesByParent.set(p.parent_post_id, []);
      repliesByParent.get(p.parent_post_id)!.push(p);
    }
  }

  return (
    <div>
      {/* Thread body */}
      {thread.body && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-200">
          <Markdown>{thread.body}</Markdown>
        </div>
      )}

      {/* Thread reactions + spawn-campaign */}
      <div className="mt-3 flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
        <ReactionBtn
          type="thread"
          id={thread.id}
          reaction="upvote"
          count={thread.upvote_count + (hasReaction("thread", thread.id, "upvote") && !initialReactions.some((r) => r.target_type === "thread" && r.target_id === thread.id && r.reaction === "upvote") ? 1 : 0)}
          active={hasReaction("thread", thread.id, "upvote")}
          onClick={() => react("thread", thread.id, "upvote")}
          disabled={!currentUserId}
          icon="↑"
          label="Upvote"
        />
        <ReactionBtn
          type="thread"
          id={thread.id}
          reaction="helpful"
          count={thread.helpful_count}
          active={hasReaction("thread", thread.id, "helpful")}
          onClick={() => react("thread", thread.id, "helpful")}
          disabled={!currentUserId}
          icon="★"
          label="Helpful"
        />
        <span className="text-xs text-zinc-500">·</span>
        <span className="text-xs text-zinc-500">{thread.post_count} replies</span>

        {userIsCreator && (
          <a
            href={`/admin/campaigns/new?from_thread=${thread.id}`}
            className="ml-auto rounded-md border border-emerald-700/50 px-3 py-1.5 text-xs text-emerald-300 hover:border-emerald-500"
            title="Spawn a campaign from this thread"
          >
            ✨ Turn into campaign
          </a>
        )}
      </div>

      {/* Reply form */}
      {currentUserId ? (
        canReply ? (
          <ReplyForm threadId={thread.id} threadState={threadState} parentPostId={null} placeholder="Add to the discussion…" />
        ) : (
          <div className="mt-6 rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-sm text-amber-200">
            {replyBlockReason}
          </div>
        )
      ) : (
        <div className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm text-zinc-400">
          <a href="/login" className="text-emerald-400 hover:underline">Sign in</a> to reply.
        </div>
      )}

      {/* Replies */}
      {topLevel.length > 0 && (
        <ul className="mt-8 space-y-4">
          {topLevel.map((p) => (
            <li key={p.id}>
              <PostCard
                post={p}
                authorName={authorNamesLocal[p.author_id ?? ""] ?? "Member"}
                threadState={threadState}
                hasUpvote={hasReaction("post", p.id, "upvote")}
                hasHelpful={hasReaction("post", p.id, "helpful")}
                onReact={(reaction) => react("post", p.id, reaction)}
                canReply={canReply}
                currentUserId={currentUserId}
                isOwnPost={p.author_id === currentUserId}
              />

              {/* One level of replies under this post */}
              {(repliesByParent.get(p.id) ?? []).map((r) => (
                <div key={r.id} className="ml-3 mt-3 sm:ml-8">
                  <PostCard
                    post={r}
                    authorName={authorNamesLocal[r.author_id ?? ""] ?? "Member"}
                    threadState={threadState}
                    hasUpvote={hasReaction("post", r.id, "upvote")}
                    hasHelpful={hasReaction("post", r.id, "helpful")}
                    onReact={(reaction) => react("post", r.id, reaction)}
                    canReply={false}  // no nested replies (Reddit-flat = one level)
                    currentUserId={currentUserId}
                    isOwnPost={r.author_id === currentUserId}
                  />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PostCard({
  post,
  authorName,
  threadState,
  hasUpvote,
  hasHelpful,
  onReact,
  canReply,
  currentUserId,
  isOwnPost,
}: {
  post: PostRow;
  authorName: string;
  threadState: string;
  hasUpvote: boolean;
  hasHelpful: boolean;
  onReact: (reaction: "upvote" | "helpful") => void;
  canReply: boolean;
  currentUserId: string | null;
  isOwnPost: boolean;
}) {
  const [showReply, setShowReply] = useState(false);
  const isFromOutOfState = post.author_state && post.author_state !== threadState;
  const isInReview = isOwnPost && post.moderation_status && post.moderation_status !== "approved";

  return (
    <div
      className={`rounded-lg border p-4 ${
        isInReview
          ? "border-amber-700/40 bg-amber-950/10"
          : "border-zinc-800 bg-zinc-950/40"
      }`}
    >
      {isInReview && (
        <div className="mb-3 rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          ⏳ Your post is in review
          {post.moderation_status === "auto_flagged" && " — looks like it contains a link or contact info that needs a moderator's OK"}
          {post.moderation_status === "pending" && " — first few posts are reviewed before they go live"}
          {post.moderation_status === "user_flagged" && " — another member reported this; a moderator will check"}
          . Only you and moderators can see it.
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {post.author_id ? (
          <a href={`/profile/${post.author_id}`} className="font-medium text-zinc-300 hover:text-emerald-400">
            {authorName}
          </a>
        ) : (
          <span className="font-medium text-zinc-300">{authorName}</span>
        )}
        {isFromOutOfState && (
          <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-purple-300">
            From {post.author_state}
          </span>
        )}
        <span>·</span>
        <span>{timeAgo(post.created_at)}</span>
      </div>
      <div className="mt-2 text-sm text-zinc-200">
        <Markdown>{post.body}</Markdown>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <ReactionBtn
          type="post"
          id={post.id}
          reaction="upvote"
          count={post.upvote_count}
          active={hasUpvote}
          onClick={() => onReact("upvote")}
          disabled={!currentUserId}
          icon="↑"
          label="Upvote"
        />
        <ReactionBtn
          type="post"
          id={post.id}
          reaction="helpful"
          count={post.helpful_count}
          active={hasHelpful}
          onClick={() => onReact("helpful")}
          disabled={!currentUserId}
          icon="★"
          label="Helpful"
        />
        {canReply && (
          <button
            onClick={() => setShowReply((v) => !v)}
            className="text-zinc-500 hover:text-emerald-400"
          >
            {showReply ? "Cancel" : "Reply"}
          </button>
        )}
        {currentUserId && !isOwnPost && (
          <ReportButton targetType="post" targetId={post.id} />
        )}
      </div>

      {showReply && (
        <div className="mt-3">
          <ReplyForm
            threadId={post.thread_id}
            threadState={threadState}
            parentPostId={post.id}
            placeholder="Reply to this post…"
            onPosted={() => setShowReply(false)}
          />
        </div>
      )}
    </div>
  );
}

function ReactionBtn({
  count, active, onClick, disabled, icon, label,
}: {
  type: string; id: string; reaction: string;
  count: number; active: boolean;
  onClick: () => void; disabled?: boolean; icon: string; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Sign in to react" : label}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "bg-emerald-500 font-semibold text-zinc-950"
          : "border border-zinc-800 text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
      }`}
    >
      <span>{icon}</span>
      <span>{count}</span>
    </button>
  );
}

function ReplyForm({
  threadId,
  threadState,
  parentPostId,
  placeholder,
  onPosted,
}: {
  threadId: string;
  threadState: string;
  parentPostId: string | null;
  placeholder: string;
  onPosted?: () => void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    const fd = new FormData();
    fd.set("thread_id", threadId);
    if (parentPostId) fd.set("parent_post_id", parentPostId);
    fd.set("body", body);
    startTransition(async () => {
      const result = await createPost(fd);
      if (result.error) {
        setError(result.error);
      } else {
        setBody("");
        onPosted?.();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-6">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={4}
        maxLength={20000}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
      {error && (
        <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Posting as a {threadState}-state participant. Out-of-state posts get a badge.
        </p>
        <button
          type="submit"
          disabled={pending || !body.trim()}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Posting…" : "Post reply"}
        </button>
      </div>
    </form>
  );
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

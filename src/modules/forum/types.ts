export type ForumTag =
  | "general"
  | "legislation"
  | "news"
  | "event"
  | "meetup"
  | "market";

export const TAG_LABELS: Record<ForumTag, string> = {
  general: "General",
  legislation: "Legislation",
  news: "News",
  event: "Event",
  meetup: "Meet-up",
  market: "Market",
};

export const TAG_COLORS: Record<ForumTag, string> = {
  general: "bg-zinc-900 text-zinc-300",
  legislation: "bg-emerald-950/40 text-emerald-300",
  news: "bg-blue-950/40 text-blue-300",
  event: "bg-purple-950/40 text-purple-300",
  meetup: "bg-amber-950/40 text-amber-300",
  market: "bg-rose-950/40 text-rose-300",
};

export type ThreadRow = {
  id: string;
  state: string | null;
  locality: string | null;
  author_id: string | null;
  author_state: string | null;
  title: string;
  body: string | null;
  tag: string;
  residents_only: boolean;
  pinned: boolean;
  locked: boolean;
  post_count: number;
  upvote_count: number;
  helpful_count: number;
  last_activity_at: string;
  created_at: string;
};

export type PostRow = {
  id: string;
  thread_id: string;
  parent_post_id: string | null;
  author_id: string | null;
  author_state: string | null;
  body: string;
  upvote_count: number;
  helpful_count: number;
  deleted_at: string | null;
  /** Optional — only set when client query selects it. */
  moderation_status?: "approved" | "pending" | "auto_flagged" | "user_flagged" | "removed";
  created_at: string;
};

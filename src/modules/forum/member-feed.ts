import { DELETED_THREAD_BODY } from "@/lib/forum-permissions";

/**
 * What people posted, with the bot and the campaigns left out. The forum holds
 * hundreds of automated bill threads against a handful written by members, so
 * anything that mixes the two buries the members.
 */

export type FeedItem = {
  kind: "thread" | "reply";
  place: string | null;
  title: string;
  href: string;
  author: string | null;
  at: string;
};

type Thread = {
  id: string;
  state: string | null;
  title: string;
  body?: string | null;
  author_id: string | null;
  created_at: string;
  system_generated?: boolean | null;
};

type Post = { thread_id: string; author_id: string | null; created_at: string };

export function memberFeedItems(input: {
  threads: Thread[];
  posts: Post[];
  parents: Map<string, { title: string; state: string | null }>;
  names: Map<string, string>;
  limit: number;
}): FeedItem[] {
  const { threads, posts, parents, names, limit } = input;
  const items: FeedItem[] = [];

  for (const t of threads) {
    if (t.system_generated || !t.author_id || t.body === DELETED_THREAD_BODY) continue;
    items.push({
      kind: "thread",
      place: t.state,
      title: t.title,
      href: `/forum/${t.state ?? "national"}/${t.id}`,
      author: names.get(t.author_id) ?? null,
      at: t.created_at,
    });
  }

  for (const p of posts) {
    const parent = parents.get(p.thread_id);
    if (!p.author_id || !parent) continue;
    items.push({
      kind: "reply",
      place: parent.state,
      title: parent.title,
      href: `/forum/${parent.state ?? "national"}/${p.thread_id}`,
      author: names.get(p.author_id) ?? null,
      at: p.created_at,
    });
  }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}

/** Bill threads that have gone quiet for this long get a notice, and a moderator's eye. */
export const STALE_BILL_DAYS = 180;

export function isStaleBill(lastActionAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastActionAt) return false;
  return now - new Date(lastActionAt).getTime() > STALE_BILL_DAYS * 86_400_000;
}

/**
 * Merging a fresh history read into what the Lounge already shows (B8).
 *
 * The chat drops its realtime socket while it is closed, minimized or left in
 * a background tab (free Supabase allows 200 sockets at once), so every reopen
 * reads the latest page again. That read is the truth for its own window:
 * anything deleted meanwhile disappears, and anything that arrived over
 * realtime after it (newer than its newest row) is kept.
 */

type Timed = { id: string; created_at: string };

export function mergeFresh<T extends Timed>(fresh: T[], current: T[]): T[] {
  if (fresh.length === 0) return current;
  const newest = fresh[fresh.length - 1].created_at;
  const ids = new Set(fresh.map((m) => m.id));
  const later = current.filter((m) => !ids.has(m.id) && m.created_at > newest);
  return [...fresh, ...later];
}

type Keyed = { message_id: string };

/** Fresh reaction rows replace those of the messages they cover. */
export function mergeReactionRows<T extends Keyed>(fresh: T[], current: T[], coveredIds: string[]): T[] {
  const covered = new Set(coveredIds);
  return [...current.filter((r) => !covered.has(r.message_id)), ...fresh];
}

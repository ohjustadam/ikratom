/**
 * Quick reactions on Lounge messages (B8). A fixed, short list: one tap, no
 * picker to hunt through, and nothing a member can type into. The database
 * holds the same list in a CHECK constraint (migration 0336); a test keeps
 * the two identical.
 */

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🙏", "💪", "😮"] as const;
export type QuickReaction = (typeof QUICK_REACTIONS)[number];

/** Plain names for screen readers and tooltips. */
export const REACTION_LABELS: Record<QuickReaction, string> = {
  "👍": "thumbs up",
  "❤️": "love",
  "😂": "laughing",
  "🙏": "thank you",
  "💪": "strong",
  "😮": "wow",
};

export function isQuickReaction(x: unknown): x is QuickReaction {
  return typeof x === "string" && (QUICK_REACTIONS as readonly string[]).includes(x);
}

export type ReactionRow = { message_id: string; user_id: string; emoji: string };
export type ReactionTally = { emoji: QuickReaction; count: number; mine: boolean };

/** Group raw rows into per-message chips, in the fixed list's order. */
export function tallyReactions(rows: ReactionRow[], meId: string | null): Map<string, ReactionTally[]> {
  const counts = new Map<string, Map<QuickReaction, { count: number; mine: boolean }>>();
  for (const r of rows) {
    if (!isQuickReaction(r.emoji)) continue;
    const per = counts.get(r.message_id) ?? new Map();
    const cur = per.get(r.emoji) ?? { count: 0, mine: false };
    per.set(r.emoji, { count: cur.count + 1, mine: cur.mine || (!!meId && r.user_id === meId) });
    counts.set(r.message_id, per);
  }
  const out = new Map<string, ReactionTally[]>();
  for (const [id, per] of counts) {
    out.set(id, QUICK_REACTIONS.filter((e) => per.has(e)).map((e) => ({ emoji: e, ...per.get(e)! })));
  }
  return out;
}

/** Add or remove one row, keeping the list free of duplicates. */
export function applyReaction(rows: ReactionRow[], row: ReactionRow, on: boolean): ReactionRow[] {
  const same = (r: ReactionRow) => r.message_id === row.message_id && r.user_id === row.user_id && r.emoji === row.emoji;
  const rest = rows.filter((r) => !same(r));
  return on ? [...rest, row] : rest;
}

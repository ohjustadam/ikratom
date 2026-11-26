"use client";

import { QUICK_REACTIONS, REACTION_LABELS, type QuickReaction, type ReactionTally } from "@/lib/chat-reactions";

/**
 * Under a Lounge message: the reactions it has (tap one to add or take back
 * yours), and, when the member opened it, the row of six quick reactions.
 */
export function ReactionBar({
  tallies,
  picking,
  canReact,
  onReact,
}: {
  tallies: ReactionTally[];
  picking: boolean;
  canReact: boolean;
  onReact: (emoji: QuickReaction) => void;
}) {
  if (!tallies.length && !picking) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      {tallies.map((t) => (
        <button
          key={t.emoji}
          type="button"
          disabled={!canReact}
          aria-pressed={t.mine}
          aria-label={`${REACTION_LABELS[t.emoji]}, ${t.count}${t.mine ? ", including you" : ""}`}
          onClick={() => onReact(t.emoji)}
          className={`flex min-h-8 items-center gap-1 rounded-full border px-2 text-[0.85em] leading-none ${t.mine ? "border-[var(--lc-accent)] bg-[var(--lc-mention)]" : "border-[var(--lc-border)]"}`}
        >
          <span aria-hidden>{t.emoji}</span>
          <span>{t.count}</span>
        </button>
      ))}
      {picking && (
        <div role="group" aria-label="Quick reactions" className="flex flex-wrap gap-1 rounded-full border border-[var(--lc-border)] bg-[var(--lc-surface)] px-1 py-0.5">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => onReact(e)}
              aria-label={`React: ${REACTION_LABELS[e]}`}
              title={REACTION_LABELS[e]}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg hover:bg-[var(--lc-bg)]"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

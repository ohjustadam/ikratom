"use client";

/**
 * The @-autocomplete list shown above the Lounge composer. Suggestions come
 * only from people already visible in the conversation, so it never exposes a
 * username search.
 */
export function MentionSuggest({
  options,
  active,
  onPick,
}: {
  options: string[];
  active: number;
  onPick: (handle: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <ul role="listbox" aria-label="Mention someone" className="mb-1.5 overflow-hidden rounded-md border border-[var(--lc-border)] bg-[var(--lc-surface)] text-[length:var(--lc-size)]">
      {options.map((h, i) => (
        <li key={h} role="option" aria-selected={i === active}>
          <button
            type="button"
            // mousedown, not click: keeps focus (and the caret) in the textarea.
            onMouseDown={(e) => { e.preventDefault(); onPick(h); }}
            className={`block min-h-10 w-full px-3 py-1.5 text-left ${i === active ? "bg-[var(--lc-mention)] text-[var(--lc-name)]" : "text-[var(--lc-text)] hover:bg-[var(--lc-bg)]"}`}
          >
            @{h}
          </button>
        </li>
      ))}
    </ul>
  );
}

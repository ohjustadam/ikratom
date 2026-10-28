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
    <ul role="listbox" aria-label="Mention someone" className="mb-1.5 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900 text-sm">
      {options.map((h, i) => (
        <li key={h} role="option" aria-selected={i === active}>
          <button
            type="button"
            // mousedown, not click: keeps focus (and the caret) in the textarea.
            onMouseDown={(e) => { e.preventDefault(); onPick(h); }}
            className={`block w-full px-3 py-1.5 text-left ${i === active ? "bg-emerald-950/60 text-emerald-200" : "text-zinc-300 hover:bg-zinc-800"}`}
          >
            @{h}
          </button>
        </li>
      ))}
    </ul>
  );
}

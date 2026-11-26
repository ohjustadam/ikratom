"use client";

import { useState } from "react";
import { EMOJI_GROUPS } from "./emoji-data";

/**
 * The Lounge emoji picker. Loaded only when a member taps 😊 (next/dynamic in
 * ComposerToolbar), so nobody else downloads it. Big buttons in plain groups.
 */
export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [group, setGroup] = useState(0);
  const g = EMOJI_GROUPS[group];
  return (
    <div role="dialog" aria-label="Choose an emoji" className="mb-2 rounded-lg border border-[var(--lc-border)] bg-[var(--lc-surface)] p-2">
      <div role="tablist" aria-label="Emoji groups" className="flex items-center gap-1 border-b border-[var(--lc-border)] pb-1">
        {EMOJI_GROUPS.map((x, i) => (
          <button
            key={x.label}
            type="button"
            role="tab"
            aria-selected={i === group}
            aria-label={x.label}
            title={x.label}
            onClick={() => setGroup(i)}
            className={`flex h-9 w-9 items-center justify-center rounded-md text-lg ${i === group ? "bg-[var(--lc-bg)] ring-1 ring-[var(--lc-accent)]" : "hover:bg-[var(--lc-bg)]"}`}
          >
            {x.icon}
          </button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto min-h-9 rounded-md px-2 text-xs text-[var(--lc-muted)] hover:text-[var(--lc-text)]">
          Close
        </button>
      </div>
      <p className="mt-1 text-[11px] text-[var(--lc-muted)]">{g.label}</p>
      <div role="tabpanel" aria-label={g.label} className="grid max-h-36 grid-cols-8 gap-0.5 overflow-y-auto">
        {g.emoji.map((e) => (
          <button
            key={e}
            type="button"
            // mousedown, not click: keeps the caret where it was in the message box.
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick(e)}
            className="flex h-10 items-center justify-center rounded-md text-xl hover:bg-[var(--lc-bg)]"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

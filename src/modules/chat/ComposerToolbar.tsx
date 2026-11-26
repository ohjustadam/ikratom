"use client";

import dynamic from "next/dynamic";

const EmojiPicker = dynamic(() => import("./EmojiPicker"), {
  ssr: false,
  loading: () => <p className="mb-2 text-xs text-[var(--lc-muted)]">Loading emoji…</p>,
});

const tool =
  "flex min-h-9 min-w-9 items-center justify-center rounded-md border border-[var(--lc-border)] px-2 text-sm hover:bg-[var(--lc-surface)] focus-visible:outline-2 focus-visible:outline-[var(--lc-accent)]";

/**
 * Bold, italic and emoji above the Lounge message box. B and I wrap the
 * selected words in **…** or *…* (typing the stars works too). The emoji
 * picker's code loads only the first time someone opens it.
 */
export function ComposerToolbar({
  onBold,
  onItalic,
  emojiOpen,
  onEmojiToggle,
  onEmoji,
}: {
  onBold: () => void;
  onItalic: () => void;
  emojiOpen: boolean;
  onEmojiToggle: () => void;
  onEmoji: (e: string) => void;
}) {
  // mousedown preventDefault keeps the selection in the message box.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <>
      {emojiOpen && <EmojiPicker onPick={onEmoji} onClose={onEmojiToggle} />}
      <div className="mb-1.5 flex items-center gap-1" role="toolbar" aria-label="Formatting">
        <button type="button" onMouseDown={keep} onClick={onBold} aria-label="Bold" title="Bold: **like this**" className={`${tool} font-bold`}>
          B
        </button>
        <button type="button" onMouseDown={keep} onClick={onItalic} aria-label="Italic" title="Italic: *like this*" className={`${tool} font-serif italic`}>
          I
        </button>
        <button type="button" onMouseDown={keep} onClick={onEmojiToggle} aria-expanded={emojiOpen} aria-label="Add an emoji" title="Emoji" className={tool}>
          <span aria-hidden>😊</span>
        </button>
        <span className="ml-auto text-[11px] text-[var(--lc-muted)] pointer-coarse:hidden">Enter sends · Shift+Enter new line</span>
      </div>
    </>
  );
}

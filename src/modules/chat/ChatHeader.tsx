"use client";

import type { ChatWindow } from "./use-chat-window";

const btn =
  "flex min-h-10 min-w-10 items-center justify-center rounded-md px-2 text-[var(--lc-muted)] hover:bg-[var(--lc-bg)] hover:text-[var(--lc-text)] focus-visible:outline-2 focus-visible:outline-[var(--lc-accent)]";

/**
 * The Lounge title bar. On a wide screen it is also the drag handle (buttons
 * inside it don't start a drag). Big, plainly labelled buttons: many members
 * are older and on phones.
 */
export function ChatHeader({
  win,
  signedIn,
  keepOpen,
  onKeepOpen,
  settingsOpen,
  onSettings,
  onClose,
}: {
  win: ChatWindow;
  signedIn: boolean;
  keepOpen: boolean;
  onKeepOpen: (v: boolean) => void;
  settingsOpen: boolean;
  onSettings: () => void;
  onClose: () => void;
}) {
  return (
    <div
      onPointerDown={win.wide ? (e) => win.startDrag("move", e) : undefined}
      title={win.wide ? "Drag here to move the chat" : undefined}
      className={`flex shrink-0 items-center justify-between gap-1 border-b border-[var(--lc-border)] bg-[var(--lc-surface)] py-1 pr-1 ${win.wide ? "cursor-move select-none pl-9" : "pl-3"}`}
    >
      <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
        <span>Lounge</span>
        <span className="rounded bg-[var(--lc-mention)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--lc-name)]">Live</span>
      </h2>
      <div className="flex items-center gap-0.5">
        {signedIn && (
          <button
            type="button"
            role="switch"
            aria-checked={keepOpen}
            onClick={() => onKeepOpen(!keepOpen)}
            title="Keep chat open when I change pages"
            aria-label="Keep chat open when I change pages"
            className={`${btn} gap-1.5 text-xs`}
          >
            <span aria-hidden className={`relative h-4 w-7 rounded-full transition ${keepOpen ? "bg-[var(--lc-accent)]" : "bg-[var(--lc-border)]"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--lc-bg)] transition-all ${keepOpen ? "left-3.5" : "left-0.5"}`} />
            </span>
            <span>Keep open</span>
          </button>
        )}
        {win.wide && win.moved && (
          <button type="button" onClick={win.reset} className={btn} aria-label="Put the chat back in the corner at its normal size" title="Reset size and place">
            <span aria-hidden>↺</span>
          </button>
        )}
        {signedIn && (
          <button
            type="button"
            onClick={onSettings}
            aria-expanded={settingsOpen}
            aria-label={settingsOpen ? "Close text and color settings" : "Text size, font and colors"}
            title="Text size, font and colors"
            className={`${btn} font-serif text-sm font-bold ${settingsOpen ? "bg-[var(--lc-bg)] text-[var(--lc-text)]" : ""}`}
          >
            Aa
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close chat" title="Close chat" className={`${btn} text-base`}>
          ✕
        </button>
      </div>
    </div>
  );
}

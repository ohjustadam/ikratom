"use client";

import { useState, type RefObject } from "react";
import { toggleWrap } from "@/lib/chat-format";
import { completeMention, mentionAtCaret } from "@/lib/mentions";
import { isSendKey } from "@/lib/enter-to-send";
import { MentionSuggest } from "./MentionSuggest";
import { ComposerToolbar } from "./ComposerToolbar";

export const MAX_BODY = 500;

/**
 * The Lounge message box: bold / italic / emoji toolbar, @-autocomplete from
 * the people already in the conversation (never a username search), and Send.
 * The draft lives in the parent so "Reply" on a message can fill it in.
 */
export function ChatComposer({
  draft,
  setDraft,
  inputRef,
  people,
  sending,
  onSend,
}: {
  draft: string;
  setDraft: (v: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  people: string[];
  sending: boolean;
  onSend: () => void;
}) {
  const [caret, setCaret] = useState(0);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const typing = mentionAtCaret(draft, caret);
  const suggestions = typing ? people.filter((u) => u.startsWith(typing.query)).slice(0, 5) : [];

  /** Replace the text and put the selection back, with focus in the box. */
  function edit(text: string, start: number, end = start) {
    setDraft(text.slice(0, MAX_BODY));
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(start, end);
      setCaret(end);
    });
  }

  function selection() {
    const el = inputRef.current;
    return { s: el?.selectionStart ?? draft.length, e: el?.selectionEnd ?? draft.length };
  }

  function wrap(kind: "bold" | "italic") {
    const { s, e } = selection();
    const r = toggleWrap(draft, s, e, kind);
    edit(r.text, r.start, r.end);
  }

  // After the selection, never over it: picking an emoji must not delete words.
  function insertEmoji(emoji: string) {
    const { e } = selection();
    edit(draft.slice(0, e) + emoji + draft.slice(e), e + emoji.length);
  }

  function pickMention(handle: string) {
    if (!typing) return;
    setSuggestIdx(0);
    edit(completeMention(draft, typing.start, caret, handle), typing.start + handle.length + 2);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      const n = suggestions.length;
      if (e.key === "ArrowDown") { e.preventDefault(); setSuggestIdx((i) => (i + 1) % n); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSuggestIdx((i) => (i - 1 + n) % n); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(suggestions[Math.min(suggestIdx, n - 1)]); return; }
      if (e.key === "Escape") { e.preventDefault(); setCaret(0); return; }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "i")) { e.preventDefault(); wrap(e.key === "b" ? "bold" : "italic"); return; }
    if (isSendKey(e)) { e.preventDefault(); setEmojiOpen(false); onSend(); }
  }

  return (
    <>
      <ComposerToolbar
        onBold={() => wrap("bold")}
        onItalic={() => wrap("italic")}
        emojiOpen={emojiOpen}
        onEmojiToggle={() => setEmojiOpen((v) => !v)}
        onEmoji={insertEmoji}
      />
      <MentionSuggest options={suggestions} active={Math.min(suggestIdx, Math.max(0, suggestions.length - 1))} onPick={pickMention} />
      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); setSuggestIdx(0); }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          placeholder="Say hi… (@ to mention)"
          aria-label="Your message"
          rows={1}
          maxLength={MAX_BODY}
          className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-[var(--lc-border)] bg-[var(--lc-bg)] px-3 py-2 text-[length:var(--lc-size)] text-[var(--lc-text)] placeholder:text-[var(--lc-muted)] focus:border-[var(--lc-accent)] focus:outline-none"
        />
        <button
          type="button"
          onClick={() => { setEmojiOpen(false); onSend(); }}
          disabled={sending || draft.trim().length === 0}
          className="min-h-11 rounded-md bg-[var(--lc-accent)] px-4 font-semibold text-[var(--lc-on-accent)] disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </>
  );
}

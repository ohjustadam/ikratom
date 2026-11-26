"use client";

import { useEffect, useRef } from "react";
import type { QuickReaction, ReactionTally } from "@/lib/chat-reactions";
import type { ChatMessage } from "./actions";
import type { AuthorInfo } from "./use-author-map";
import { ChatMessageRow } from "./ChatMessageRow";

const NONE: ReactionTally[] = [];

/**
 * The Lounge's scrolling message list. Sticks to the newest message unless
 * the member has scrolled up to read, and scrolls a linked message (from a
 * mention notification) into view once it has loaded. Signed-out visitors
 * never get messages: the database only returns them to signed-in members.
 */
export function ChatMessages(props: {
  messages: ChatMessage[];
  loaded: boolean;
  authorMap: Record<string, AuthorInfo>;
  reactions: Map<string, ReactionTally[]>;
  meId: string | null;
  myUsername: string | null;
  highlightId: string | null;
  onReply: (username: string) => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: QuickReaction) => void;
}) {
  const { messages, loaded, highlightId, meId } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!highlightId || !loaded) return;
    const el = document.getElementById(`lounge-msg-${highlightId}`);
    if (el) { stick.current = false; el.scrollIntoView({ block: "center" }); }
  }, [highlightId, loaded, messages.length]);

  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      role="log"
      aria-label="Lounge messages"
      className="min-h-[6rem] flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-[length:var(--lc-size)] leading-snug"
    >
      {!meId && (
        <p className="py-10 text-center text-[var(--lc-muted)]">Sign in to see the conversation and join in.</p>
      )}
      {meId && !loaded && <p className="py-10 text-center text-[var(--lc-muted)]">Loading…</p>}
      {meId && loaded && messages.length === 0 && (
        <p className="py-10 text-center text-[var(--lc-muted)]">Be the first to say hi.</p>
      )}
      {messages.map((m) => (
        <ChatMessageRow
          key={m.id}
          m={m}
          author={props.authorMap[m.user_id]}
          meId={meId}
          myUsername={props.myUsername}
          highlighted={m.id === highlightId}
          tallies={props.reactions.get(m.id) ?? NONE}
          onReply={props.onReply}
          onDelete={props.onDelete}
          onReact={props.onReact}
        />
      ))}
    </div>
  );
}

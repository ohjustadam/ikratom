"use client";

import { useState } from "react";
import { RoleTag } from "@/components/RoleTag";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import type { QuickReaction, ReactionTally } from "@/lib/chat-reactions";
import type { ChatMessage } from "./actions";
import type { AuthorInfo } from "./use-author-map";
import { FormattedText } from "./FormattedText";
import { ReactionBar } from "./ReactionBar";

const act =
  "ml-1 inline-flex min-h-7 min-w-7 items-center justify-center rounded text-[0.8em] text-[var(--lc-muted)] hover:text-[var(--lc-text)] align-middle";

/**
 * One Lounge message: the author's @handle (publicHandle only, never a real
 * name), the formatted text, the time, and the actions. Flowing text, not a
 * flex row, so on a phone it wraps under the name instead of squeezing into a
 * thin column beside it.
 */
export function ChatMessageRow({
  m,
  author,
  meId,
  myUsername,
  highlighted,
  tallies,
  onReply,
  onDelete,
  onReact,
}: {
  m: ChatMessage;
  author: AuthorInfo | undefined;
  meId: string | null;
  myUsername: string | null;
  highlighted: boolean;
  tallies: ReactionTally[];
  onReply: (username: string) => void;
  onDelete: (id: string) => void;
  onReact: (id: string, emoji: QuickReaction) => void;
}) {
  const [picking, setPicking] = useState(false);
  const signedIn = !!meId;
  const mine = signedIn && meId === m.user_id;
  const mentionsMe = !!myUsername && !mine && m.body.toLowerCase().includes(`@${myUsername}`);
  const tint = highlighted
    ? "rounded bg-[var(--lc-mention)] ring-1 ring-[var(--lc-accent)]"
    : mentionsMe ? "rounded bg-[var(--lc-mention)]" : "";
  return (
    <div id={`lounge-msg-${m.id}`} className={`group wrap-anywhere ${tint}`}>
      <a href={`/profile/${m.user_id}`} className={`font-semibold hover:underline ${author?.isAdmin ? "text-[var(--lc-admin)]" : "text-[var(--lc-name)]"}`}>
        {author?.name ?? "…"}
        <RoleTag role={author?.role} />
      </a>
      <span className="text-[var(--lc-muted)]">: </span>
      <span className="whitespace-pre-wrap"><FormattedText body={m.body} me={myUsername} /></span>
      <span className="ml-2 whitespace-nowrap text-[0.72em] text-[var(--lc-muted)]">
        {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </span>
      {signedIn && (
        <button type="button" onClick={() => setPicking((v) => !v)} aria-expanded={picking} aria-label="React to this message" title="React" className={act}>
          <span aria-hidden>☺</span>
        </button>
      )}
      {signedIn && !mine && author?.username && (
        <button type="button" onClick={() => onReply(author.username!)} aria-label={`Reply to @${author.username}`} title="Reply" className={act}>
          ↩
        </button>
      )}
      {mine && (
        <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete message" title="Delete" className={`${act} hidden hover:text-red-400 group-hover:inline-flex pointer-coarse:inline-flex`}>
          ✕
        </button>
      )}
      {signedIn && !mine && (
        <ReportButton targetType="lounge_message" targetId={m.id} label="⚑" className={`${act} hover:text-red-400`} />
      )}
      <ReactionBar
        tallies={tallies}
        picking={picking}
        canReact={signedIn}
        onReact={(e) => { setPicking(false); onReact(m.id, e); }}
      />
    </div>
  );
}

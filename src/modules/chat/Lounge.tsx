"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { postChatMessage, deleteChatMessage, type ChatMessage } from "./actions";

/**
 * Live community chat for the forum index. Three jobs in one component:
 *   1. Show last N messages, append new ones in realtime
 *   2. Show "X online now" via Realtime presence
 *   3. Let users post + delete (own messages or any if admin)
 *
 * Why this lives at /forum and not as a global widget: the goal is to make
 * the forum feel inhabited, not to replace DMs or threads. Putting it on
 * /forum specifically means people land here, see activity, and stick.
 *
 * Anti-flood UX: rate limit is enforced server-side; the client just shows
 * the error if it bounces.
 */

type Author = { id: string; name: string; isAdmin: boolean };

export function Lounge({
  room,
  initial,
  authors,
  me,
  isAdmin,
  signedIn,
}: {
  room: string;
  initial: ChatMessage[];
  authors: Record<string, { name: string; isAdmin: boolean }>;
  me: { id: string; name: string } | null;
  isAdmin: boolean;
  signedIn: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [authorMap, setAuthorMap] = useState<Record<string, { name: string; isAdmin: boolean }>>(authors);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [presenceCount, setPresenceCount] = useState<number>(1);
  const [pending, startTransition] = useTransition();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // Realtime: subscribe to inserts + deletes in this room and presence
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supabase = createClient();

    let cancelled = false;
    let activeChannel: RealtimeChannel | null = null;

    // chat_messages SELECT policy is `to authenticated` — Realtime evaluates
    // RLS for the receiving WebSocket, so we must attach the user's JWT
    // before subscribing or every postgres_changes payload is silently
    // dropped. (forum_posts has `to public` SELECT so realtime there
    // "just works" without this — that's the diff that hid this bug.)
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        supabase.realtime.setAuth(session.access_token);
      }

      const channel: RealtimeChannel = supabase.channel(`lounge:${room}`, {
        config: { presence: { key: me?.id ?? `anon-${Math.random().toString(36).slice(2, 8)}` } },
      });
      activeChannel = channel;

      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room=eq.${room}` },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
          // Lazy-fetch the author name if we don't have it yet
          if (m.user_id && !(m.user_id in authorMap)) {
            supabase
              .from("profiles")
              .select("id, full_name, is_admin")
              .eq("id", m.user_id)
              .single()
              .then(({ data }: { data: { id: string; full_name: string | null; is_admin: boolean | null } | null }) => {
                if (cancelled || !data) return;
                setAuthorMap((cur) => ({
                  ...cur,
                  [data.id]: { name: data.full_name ?? "(no name)", isAdmin: !!data.is_admin },
                }));
              });
          }
        },
      );

      channel.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: `room=eq.${room}` },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (!id) return;
          setMessages((cur) => cur.filter((x) => x.id !== id));
        },
      );

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        setPresenceCount(Object.keys(state).length);
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED" && me) {
          await channel.track({ user_id: me.id, name: me.name, online_at: new Date().toISOString() });
        }
      });
    })();

    return () => {
      cancelled = true;
      if (activeChannel) supabase.removeChannel(activeChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, me?.id]);

  // Auto-scroll to bottom unless the user has scrolled up
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 60;
  }

  function send() {
    const body = draft.trim();
    if (!body) return;
    if (body.length > 500) {
      setError("Message is too long (500 char max).");
      return;
    }
    setError(null);
    setDraft("");
    stickToBottomRef.current = true;
    startTransition(async () => {
      const r = await postChatMessage({ body, room });
      if ("error" in r) {
        setError(r.error ?? "Failed");
        setDraft(body);
      }
      // Don't push optimistically — realtime INSERT will deliver it.
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this message?")) return;
    setError(null);
    const r = await deleteChatMessage(id);
    if ("error" in r) setError(r.error ?? "Failed");
    // Realtime DELETE will remove from local state.
  }

  return (
    <div className="rounded-lg border border-emerald-700/30 bg-zinc-950/60 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="text-lg">Lounge</span>
            <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              Live
            </span>
          </h2>
          <p className="text-xs text-zinc-500">
            Quick chat for everyone — no state required. Threads are still where long-form goes.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-md bg-zinc-900/60 px-2 py-1 text-xs text-zinc-400">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          {presenceCount} online now
        </span>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="h-72 space-y-1.5 overflow-y-auto rounded-md border border-zinc-900 bg-zinc-950 p-3 text-sm"
      >
        {messages.length === 0 && (
          <p className="py-12 text-center text-xs text-zinc-600">
            Be the first to say hi.
          </p>
        )}
        {messages.map((m) => {
          const author = authorMap[m.user_id];
          const canDelete = signedIn && (isAdmin || (me && me.id === m.user_id));
          return (
            <div key={m.id} className="group flex gap-2">
              <a
                href={`/profile/${m.user_id}`}
                className={`shrink-0 font-semibold ${
                  author?.isAdmin ? "text-amber-300" : "text-emerald-300"
                } hover:underline`}
              >
                {author?.name ?? "…"}
                {author?.isAdmin && (
                  <span className="ml-1 rounded bg-amber-950/40 px-1 text-[9px] uppercase tracking-wider text-amber-300">
                    admin
                  </span>
                )}
              </a>
              <span className="text-zinc-600">:</span>
              <span className="min-w-0 flex-1 break-words text-zinc-200">{m.body}</span>
              <span className="shrink-0 text-[10px] text-zinc-700">
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {canDelete && (
                <button
                  onClick={() => onDelete(m.id)}
                  className="hidden text-[10px] text-zinc-600 hover:text-red-400 group-hover:inline"
                  aria-label="Delete"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      {signedIn ? (
        <div className="mt-3">
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Say hi…"
              rows={1}
              maxLength={500}
              className="min-h-[40px] flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={pending || draft.trim().length === 0}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
            >
              Send
            </button>
          </div>
          {error && (
            <p className="mt-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">
              {error}
            </p>
          )}
          <p className="mt-1 text-[10px] text-zinc-600">
            Enter to send · Shift+Enter for newline · {draft.length}/500
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
          <a href="/login?redirect=/forum" className="text-emerald-400 hover:underline">
            Sign in
          </a>{" "}
          to join the chat.
        </p>
      )}
    </div>
  );
}

interface AuthorMap {
  [k: string]: Author;
}
// keep type referenced for d.ts consumers; not used directly above
export type { AuthorMap };

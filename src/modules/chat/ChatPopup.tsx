"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { publicHandle } from "@/lib/public-handle";
import { createClient } from "@/lib/supabase/client";
import { useSignIn } from "@/components/auth/SignInContext";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { postChatMessage, deleteChatMessage, loadInitialChat, type ChatMessage } from "./actions";

/**
 * ChatPopup — the Lounge live chat as a floating widget available on EVERY
 * page, so a user can banter from anywhere without leaving what they're doing.
 * The full-size Lounge keeps its home on /forum (this widget hides there).
 *
 * Design choices (see docs/DECISIONS.md):
 *   - Self-contained: reuses the same server actions (postChatMessage /
 *     deleteChatMessage / loadInitialChat) + get_public_profiles RPC + the
 *     publicHandle anonymity rule as the full Lounge, but does NOT refactor
 *     Lounge.tsx — the working full chat stays untouched.
 *   - Lazy: it loads history + opens a realtime channel ONLY while the panel is
 *     open, so visitors don't each hold a WebSocket on every page. Closing the
 *     panel removes the channel.
 *   - Distinct channel name ("lounge-widget:" vs the full Lounge's "lounge:")
 *     so the two never collide if both are mounted on one client.
 *
 * Requires a <SignInProvider> ancestor (uses useSignIn). Mounted in
 * src/app/layout.tsx inside that provider.
 */

type AuthorInfo = { name: string; isAdmin: boolean };

const ROOM = "lounge";
const INITIAL_LIMIT = 25;
const MAX_BODY = 500;

export function ChatPopup() {
  const { user, ready, requireSignIn } = useSignIn();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [authorMap, setAuthorMap] = useState<Record<string, AuthorInfo>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const knownRef = useRef<Set<string>>(new Set());

  const signedIn = !!user;
  const meId = user?.id ?? null;

  // Resolve author ids → public handles via the SECURITY DEFINER RPC (the only
  // RLS-safe way to read other users' public fields). Idempotent + deduped.
  const resolveAuthors = useCallback(async (ids: (string | null | undefined)[]) => {
    const want = [...new Set(ids.filter((id): id is string => !!id && !knownRef.current.has(id)))];
    if (!want.length) return;
    want.forEach((id) => knownRef.current.add(id));
    const supabase = createClient();
    const { data } = await supabase.rpc("get_public_profiles", { p_ids: want });
    if (!data) return;
    setAuthorMap((cur) => {
      const next = { ...cur };
      for (const row of data as { id: string; username: string | null; state: string | null; is_admin: boolean | null }[]) {
        next[row.id] = { name: publicHandle(row), isAdmin: !!row.is_admin };
      }
      return next;
    });
  }, []);

  // Load history the first time the panel opens (lazy — zero work until used).
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      const initial = await loadInitialChat(ROOM, INITIAL_LIMIT);
      if (cancelled) return;
      // Merge (don't replace) so a realtime INSERT that landed while this
      // history fetch was in flight isn't clobbered. Dedup by id; keep order.
      setMessages((cur) => {
        const seen = new Set(cur.map((m) => m.id));
        return [...cur, ...initial.filter((m) => !seen.has(m.id))].sort((a, b) =>
          a.created_at < b.created_at ? -1 : 1,
        );
      });
      setLoaded(true);
      void resolveAuthors(initial.map((m) => m.user_id));
    })();
    return () => { cancelled = true; };
  }, [open, loaded, resolveAuthors]);

  // Realtime — ONLY while the panel is open. Distinct channel name from the
  // full Lounge. setAuth(token) BEFORE subscribe is mandatory: chat_messages
  // SELECT is `to authenticated`, so without the JWT every payload is dropped.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const supabase = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      // chat_messages SELECT is `to authenticated`, so anon clients have every
      // realtime payload dropped — don't waste a channel on them.
      if (!session) return;
      supabase.realtime.setAuth(session.access_token);
      const ch = supabase.channel(`lounge-widget:${ROOM}`);
      channel = ch;
      ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `room=eq.${ROOM}` },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
          void resolveAuthors([m.user_id]);
        },
      );
      ch.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages", filter: `room=eq.${ROOM}` },
        (payload) => {
          const id = (payload.old as { id?: string })?.id;
          if (id) setMessages((cur) => cur.filter((x) => x.id !== id));
        },
      );
      ch.subscribe();
    })();
    return () => { cancelled = true; if (channel) supabase.removeChannel(channel); };
  }, [open, resolveAuthors]);

  // Stick to the bottom on new messages unless the user scrolled up.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (body.length > MAX_BODY) { setError(`Message is too long (${MAX_BODY} char max).`); return; }
    if (!signedIn) { const ok = await requireSignIn(); if (!ok) return; }
    setError(null);
    setDraft("");
    stick.current = true;
    setSending(true);
    const r = await postChatMessage({ body, room: ROOM });
    setSending(false);
    if ("error" in r) { setError(r.error ?? "Failed"); setDraft(body); }
    else if ("held" in r && r.held) { setError("Your message is held for review and will appear once a moderator approves it."); }
    // Realtime INSERT delivers the message — no optimistic append.
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this message?")) return;
    const r = await deleteChatMessage(id);
    if ("error" in r) setError(r.error ?? "Failed");
    // Realtime DELETE removes it locally.
  }

  // Avoid an SSR/auth flash; hide on the forum index where the full Lounge lives.
  if (!ready) return null;
  if (pathname === "/forum") return null;

  // Shared anchor: bottom-right, above the mobile tab bar (md:hidden) + safe area.
  // z-40 launcher / z-50 panel: matches the app's float convention (buttons
  // z-40, panels z-50, modals z-[60]+) so stacking is predictable next to the
  // FeedbackWidget. Bottom offset clears the mobile tab bar + safe area.
  const anchor = "fixed right-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:right-5 md:bottom-5";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open the Lounge live chat"
        className={`${anchor} z-40 flex items-center gap-1.5 rounded-full border border-emerald-700/40 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500`}
      >
        <span aria-hidden>💬</span>
        <span className="hidden sm:inline">Lounge</span>
      </button>
    );
  }

  return (
    <div
      className={`${anchor} z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-emerald-700/30 bg-zinc-950 shadow-2xl shadow-black/60`}
      style={{ maxHeight: "min(70vh, 32rem)" }}
      role="dialog"
      aria-label="Lounge live chat"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span>Lounge</span>
          <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Live</span>
        </h2>
        <div className="flex items-center gap-1">
          <a href="/forum" className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:text-emerald-300" title="Open the full forum + Lounge">Forum ↗</a>
          <button onClick={() => setOpen(false)} aria-label="Close chat" className="rounded px-2 py-0.5 text-zinc-500 hover:text-zinc-200">✕</button>
        </div>
      </div>

      <div ref={scrollerRef} onScroll={onScroll} className="min-h-[10rem] flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-sm">
        {!loaded && <p className="py-10 text-center text-xs text-zinc-600">Loading…</p>}
        {loaded && messages.length === 0 && <p className="py-10 text-center text-xs text-zinc-600">Be the first to say hi.</p>}
        {messages.map((m) => {
          const author = authorMap[m.user_id];
          const canDelete = signedIn && meId === m.user_id;
          return (
            <div key={m.id} className="group flex gap-2">
              <a
                href={`/profile/${m.user_id}`}
                className={`shrink-0 font-semibold ${author?.isAdmin ? "text-amber-300" : "text-emerald-300"} hover:underline`}
              >
                {author?.name ?? "…"}
              </a>
              <span className="text-zinc-600">:</span>
              <span className="min-w-0 flex-1 break-words text-zinc-200">{m.body}</span>
              <span className="shrink-0 text-[10px] text-zinc-700">
                {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {canDelete && (
                <button onClick={() => onDelete(m.id)} className="hidden text-[10px] text-zinc-600 hover:text-red-400 group-hover:inline" aria-label="Delete message">✕</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-zinc-800 p-2">
        {signedIn ? (
          <>
            <div className="flex gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Say hi…"
                rows={1}
                maxLength={MAX_BODY}
                className="min-h-[38px] flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={send}
                disabled={sending || draft.trim().length === 0}
                className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                Send
              </button>
            </div>
            {error && (
              <p className="mt-1.5 rounded border border-red-900/40 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{error}</p>
            )}
          </>
        ) : (
          <button
            onClick={() => void requireSignIn()}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-zinc-800"
          >
            Sign in to join the chat
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { publicHandle } from "@/lib/public-handle";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import { deleteGroupChat, postGroupChat, type GroupChatMessage } from "@/modules/coalitions/chat-actions";

/**
 * A group's live chat (migration 0291), on the Lounge pattern: the last
 * messages from the server, then realtime inserts and deletes, plus "N here
 * now" from presence. @handle only; every line but your own can be reported.
 */
export function GroupChat({ coalitionId, initial, handles, me, canModerate }: {
  coalitionId: string;
  initial: GroupChatMessage[];
  handles: Record<string, string>;
  me: { id: string; handle: string };
  canModerate: boolean;
}) {
  const [messages, setMessages] = useState(initial);
  const [names, setNames] = useState(handles);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [here, setHere] = useState(1);
  const [pending, start] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const known = useRef(new Set(Object.keys(handles)));

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      // The SELECT policy is `to authenticated`: without the JWT, realtime
      // drops every payload silently (AGENTS.md pitfall 1).
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      const filter = `coalition_id=eq.${coalitionId}`;
      channel = supabase.channel(`group-chat:${coalitionId}`, { config: { presence: { key: me.id } } });
      channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "coalition_chat_messages", filter }, (p) => {
        const m = p.new as GroupChatMessage;
        setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m].slice(-200)));
        if (!known.current.has(m.user_id)) {
          known.current.add(m.user_id);
          supabase.rpc("get_public_profiles", { p_ids: [m.user_id] }).then((res: { data: { id: string; username: string | null; state: string | null }[] | null }) => {
            const row = res.data?.[0];
            if (!cancelled && row) setNames((cur) => ({ ...cur, [row.id]: publicHandle(row) }));
          }, () => { /* the line shows "@member" until the next load */ });
        }
      });
      // REPLICA IDENTITY FULL (0291) lets the coalition_id filter match deletes.
      channel.on("postgres_changes", { event: "DELETE", schema: "public", table: "coalition_chat_messages", filter }, (p) => {
        const id = (p.old as { id?: string })?.id;
        if (id) setMessages((cur) => cur.filter((x) => x.id !== id));
      });
      channel.on("presence", { event: "sync" }, () => setHere(Math.max(1, Object.keys(channel!.presenceState()).length)));
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel!.track({ at: new Date().toISOString() });
      });
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [coalitionId, me.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    setDraft("");
    stick.current = true;
    start(async () => {
      try {
        const r = await postGroupChat(coalitionId, body);
        if (!r.ok) { setError(r.error); setDraft(body); }
      } catch {
        setDraft(body);
        setError("Couldn't send. Check your connection and try again.");
      }
    });
  }

  async function remove(id: string) {
    if (!confirm("Delete this message?")) return;
    const r = await deleteGroupChat(id);
    if (!r.ok) setError(r.error);
    else setMessages((cur) => cur.filter((x) => x.id !== id));
  }

  return (
    <section aria-label="Group chat" className="flex flex-col rounded-lg border border-emerald-700/30 bg-zinc-950/60">
      <p className="flex items-center gap-1.5 border-b border-zinc-900 px-3 py-2 text-xs text-zinc-400">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        {here} here now · members only
      </p>
      <div ref={scroller} role="log" aria-live="polite"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}
        className="h-[60vh] space-y-2 overflow-y-auto p-3 text-sm sm:h-96">
        {messages.length === 0 && <p className="py-12 text-center text-xs text-zinc-500">No messages yet. Say hi to your group.</p>}
        {messages.map((m) => (
          <div key={m.id} id={`m-${m.id}`} className="group flex flex-wrap items-baseline gap-x-2">
            <span className={`shrink-0 font-semibold ${m.user_id === me.id ? "text-amber-300" : "text-emerald-300"}`}>
              {m.user_id === me.id ? me.handle : names[m.user_id] ?? "@member"}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-zinc-200">{m.body}</span>
            <span className="shrink-0 text-[10px] text-zinc-600">
              {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            {(m.user_id === me.id || canModerate) && (
              <button type="button" onClick={() => remove(m.id)} aria-label="Delete message"
                className="text-[11px] text-zinc-600 hover:text-red-400">✕</button>
            )}
            {m.user_id !== me.id && (
              <ReportButton targetType="group_chat_message" targetId={m.id} label="⚑"
                className="text-[11px] text-zinc-600 hover:text-red-400" />
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-900 p-3">
        <div className="flex gap-2">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} maxLength={500}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message your group…" aria-label="Message"
            className="min-h-11 flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none sm:text-sm" />
          <button type="button" onClick={send} disabled={pending || !draft.trim()}
            className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
            Send
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    </section>
  );
}

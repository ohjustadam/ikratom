"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { mergeFresh, mergeReactionRows } from "@/lib/chat-feed";
import { applyReaction, tallyReactions, type ReactionRow } from "@/lib/chat-reactions";
import type { ChatMessage } from "./actions";
import { toggleChatReaction } from "./reaction-actions";
import { useAuthorMap } from "./use-author-map";

const ROOM = "lounge";
const INITIAL_LIMIT = 25;

/**
 * The Lounge's messages, authors and reactions, live only while `live` is
 * true: the panel is open, the member is signed in and the tab is awake.
 * Going not-live removes the channel, and with no channel left supabase-js
 * closes the socket, so a closed or minimized chat holds no connection (free
 * Supabase allows 200 at once) and the launcher's unread badge takes over.
 * Each time it goes live again it subscribes first, then reads the latest
 * page straight from Supabase (RLS: signed-in only), so nothing posted in
 * between is missed and no server function wakes up.
 */
export function useLoungeFeed(live: boolean, meId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rows, setRows] = useState<ReactionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { authorMap, resolveAuthors } = useAuthorMap();

  useEffect(() => {
    if (!live) return;
    const supabase = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) { setLoaded(true); return; }
      // chat_messages / chat_reactions SELECT is `to authenticated`: without
      // the JWT every realtime payload is dropped (AGENTS.md pitfall 1).
      supabase.realtime.setAuth(session.access_token);
      const filter = `room=eq.${ROOM}`;
      const ch = supabase.channel(`lounge-widget:${ROOM}`);
      channel = ch;
      ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter }, (p) => {
        const m = p.new as ChatMessage;
        setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]));
        void resolveAuthors([m.user_id]);
      });
      ch.on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages", filter }, (p) => {
        const id = (p.old as { id?: string })?.id;
        if (id) setMessages((cur) => cur.filter((x) => x.id !== id));
      });
      ch.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_reactions", filter }, (p) => {
        setRows((cur) => applyReaction(cur, p.new as ReactionRow, true));
      });
      ch.on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_reactions", filter }, (p) => {
        const old = p.old as Partial<ReactionRow>;
        if (old.message_id && old.user_id && old.emoji) setRows((cur) => applyReaction(cur, old as ReactionRow, false));
      });
      ch.subscribe();

      const { data } = await supabase
        .from("chat_messages")
        .select("id, user_id, room, body, created_at")
        .eq("room", ROOM)
        .order("created_at", { ascending: false })
        .limit(INITIAL_LIMIT);
      if (cancelled) return;
      const fresh = ((data ?? []) as ChatMessage[]).reverse();
      setMessages((cur) => mergeFresh(fresh, cur));
      setLoaded(true);
      void resolveAuthors(fresh.map((m) => m.user_id));
      const ids = fresh.map((m) => m.id);
      if (!ids.length) return;
      const { data: rx } = await supabase.from("chat_reactions").select("message_id, user_id, emoji").in("message_id", ids);
      if (!cancelled && rx) setRows((cur) => mergeReactionRows(rx as ReactionRow[], cur, ids));
    })();
    return () => { cancelled = true; if (channel) void supabase.removeChannel(channel); };
  }, [live, resolveAuthors]);

  const reactions = useMemo(() => tallyReactions(rows, meId), [rows, meId]);

  const react = useCallback(async (messageId: string, emoji: string) => {
    if (!meId) return;
    const row = { message_id: messageId, user_id: meId, emoji };
    const wasOn = rows.some((r) => r.message_id === messageId && r.user_id === meId && r.emoji === emoji);
    setRows((cur) => applyReaction(cur, row, !wasOn));
    setError(null);
    try {
      const r = await toggleChatReaction({ messageId, emoji });
      if ("error" in r) { setRows((cur) => applyReaction(cur, row, wasOn)); setError(r.error); }
      else setRows((cur) => applyReaction(cur, row, r.on));
    } catch {
      setRows((cur) => applyReaction(cur, row, wasOn));
      setError("Couldn't react. Check your connection and try again.");
    }
  }, [meId, rows]);

  return { messages, loaded, authorMap, reactions, react, error, setError };
}

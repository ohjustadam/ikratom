"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isQuickReaction } from "@/lib/chat-reactions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tap a quick reaction on a Lounge message: adds yours, or takes it back if
 * you already reacted with that emoji (B8, table chat_reactions, mig 0336).
 *
 * RLS is the floor (as yourself, Lounge messages only, not while muted); this
 * adds the clean error messages and a rate limit, since every reaction is
 * broadcast to everyone with the chat open.
 */
export async function toggleChatReaction(input: {
  messageId: string;
  emoji: string;
}): Promise<{ ok: true; on: boolean } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to react." };

  const messageId = String(input?.messageId ?? "");
  const emoji = input?.emoji;
  if (!UUID_RE.test(messageId) || !isQuickReaction(emoji)) return { error: "That reaction isn't available." };

  if (!(await checkRateLimit(`chat:react:${user.id}`, 30, 60))) {
    return { error: "Slow down: 30 reactions a minute." };
  }

  const key = { message_id: messageId, user_id: user.id, emoji };
  const { data: removed, error: delErr } = await supabase
    .from("chat_reactions")
    .delete()
    .match(key)
    .select("message_id");
  if (delErr) return { error: "Couldn't change that reaction. Try again." };
  if ((removed ?? []).length > 0) return { ok: true, on: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("chat_muted_until")
    .eq("id", user.id)
    .single();
  if (profile?.chat_muted_until && new Date(profile.chat_muted_until).getTime() > Date.now()) {
    return { error: "You are temporarily muted from the lounge." };
  }

  const { error } = await supabase.from("chat_reactions").insert({ ...key, room: "lounge" });
  // 23505: a double tap raced itself, and the reaction is already there.
  if (error && error.code !== "23505") return { error: "Couldn't add that reaction." };
  return { ok: true, on: true };
}

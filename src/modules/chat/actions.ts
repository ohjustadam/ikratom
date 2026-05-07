"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Lounge chat — global community room shown above the forum state list.
 *
 * Why a separate module from forum/: chat is intentionally ephemeral and
 * stateless ("here's what people said in the last hour"), forum threads
 * are persistent and indexable. Different UX, different mental model.
 *
 * Rate limit: 10 messages / 60s / user — chatty enough for real banter,
 * stops a bot or a user with a stuck-key keyboard from flooding the room.
 */

export type ChatMessage = {
  id: string;
  user_id: string;
  room: string;
  body: string;
  created_at: string;
};

const MAX_BODY = 500;
const ROOM_RE = /^[a-z0-9:_-]{1,32}$/;

export async function postChatMessage(input: { body: string; room?: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to chat." };

  const room = (input.room ?? "lounge").trim();
  if (!ROOM_RE.test(room)) return { error: "Invalid room." };

  const body = (input.body ?? "").trim();
  if (body.length === 0) return { error: "Message is empty." };
  if (body.length > MAX_BODY) {
    return { error: `Message is too long (${MAX_BODY} char max).` };
  }

  if (!(await checkRateLimit(`chat:user:${user.id}`, 10, 60))) {
    return { error: "Slow down — 10 messages a minute." };
  }

  const { error, data } = await supabase
    .from("chat_messages")
    .insert({ user_id: user.id, room, body })
    .select("id, user_id, room, body, created_at")
    .single();
  if (error) return { error: error.message };
  return { ok: true, message: data as ChatMessage };
}

export async function deleteChatMessage(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  // RLS enforces the actual permission (own message OR admin).
  const { error } = await supabase.from("chat_messages").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/forum");
  return { ok: true };
}

/**
 * Initial message load for SSR. Returns most recent N msgs in room, oldest
 * first so the client can append realtime arrivals at the bottom.
 */
export async function loadInitialChat(room = "lounge", limit = 30) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_messages")
    .select("id, user_id, room, body, created_at")
    .eq("room", room)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as ChatMessage[]).reverse();
}

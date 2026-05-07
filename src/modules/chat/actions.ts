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
// Crude URL detector — covers http(s)://, bare domains with TLD, and
// shortener-y patterns. Does not try to be exhaustive; brand new accounts
// with anything that looks like a link get bounced.
const URL_RE = /\b(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|io|co|gg|xyz|info|biz|tv|me|app|link|tk|ml|ga|cf|live|shop|store|site)\b)/i;
// Repeated-character flood (10+ same char) — "aaaaaaaaaa", "!!!!!!!!!!!"
const FLOOD_RE = /(.)\1{9,}/;

const NEW_ACCOUNT_HOURS_TIGHT = 1;   // <1h: 2 msg/min, no URLs
const NEW_ACCOUNT_HOURS_SOFT = 24;   // <24h: still no URLs

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

  // Anti-spam: keyboard-mash flood detection. Always-on, including for
  // older accounts — a real user rarely sends 10+ of the same char.
  if (FLOOD_RE.test(body)) {
    return { error: "Looks like a stuck key — message rejected as flood." };
  }

  // Account-age gate: read profile created_at + admin/leader bypass + mute.
  // We deliberately do NOT trust the chat_messages RLS to enforce throttle;
  // RLS is on/off, but throttle is a graduated rule.
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_owner, is_advocate_leader, chat_muted_until, created_at")
    .eq("id", user.id)
    .single();
  const isPrivileged = !!(profile?.is_admin || profile?.is_owner || profile?.is_advocate_leader);

  // Mute check (RLS will also reject — this gives a clean error first).
  if (
    profile?.chat_muted_until &&
    new Date(profile.chat_muted_until).getTime() > Date.now()
  ) {
    return { error: "You are temporarily muted from the lounge." };
  }

  const accountAgeMs = profile?.created_at
    ? Date.now() - new Date(profile.created_at).getTime()
    : Number.POSITIVE_INFINITY;
  const accountHours = accountAgeMs / 3_600_000;

  // URL gate: accounts < 24h cannot post anything resembling a URL. Stops
  // the most common spam vector (signup → drop link). Privileged users
  // bypass.
  if (!isPrivileged && accountHours < NEW_ACCOUNT_HOURS_SOFT && URL_RE.test(body)) {
    return {
      error:
        "Brand new accounts can't post links yet. Wait 24 hours, or post your link in a forum thread.",
    };
  }

  // Rate limit: graduated. Privileged users get a generous cap; very new
  // accounts get a tighter one (so a stuck-finger newcomer doesn't get
  // permabanned by a few duplicates); everyone else the default.
  // 5/min for <1h accounts is enough for normal banter without making the
  // experience feel hostile to genuine new users.
  const limit = isPrivileged ? 30 : accountHours < NEW_ACCOUNT_HOURS_TIGHT ? 5 : 10;
  if (!(await checkRateLimit(`chat:user:${user.id}`, limit, 60))) {
    return { error: `Slow down — ${limit} messages a minute.` };
  }

  // Duplicate detection: same body from same user inside last 60s. Catches
  // copy-paste spam and "double-tap send" without re-flagging genuine
  // re-sends after a minute.
  const sixtySecAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: dupes } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("user_id", user.id)
    .eq("body", body)
    .gte("created_at", sixtySecAgo)
    .limit(1);
  if ((dupes ?? []).length > 0) {
    return { error: "You just sent that — wait a minute before repeating." };
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

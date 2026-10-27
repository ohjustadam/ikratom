"use server";

import { createClient } from "@/lib/supabase/server";
import { assertNotReadOnly } from "@/lib/read-only-mode";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Live group chat (migration 0291, B4 e). Writes go through the USER's
 * client, so RLS is what proves membership; the checks here only return a
 * readable error. No push per message: a busy chat would buzz every phone in
 * the group, so chat is pull-only (the board and events still notify).
 *
 * Throttle: 10 lines a minute and 300 a day per member, plus the Lounge's
 * stuck-key and double-send guards.
 */

export type GroupChatMessage = { id: string; coalition_id: string; user_id: string; body: string; created_at: string };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_BODY = 500;
const FLOOD_RE = /(.)\1{9,}/;

type Result = { ok: true } | { ok: false; error: string };

export async function postGroupChat(coalitionId: string, text: string): Promise<Result> {
  const ro = await assertNotReadOnly();
  if (ro) return { ok: false, error: ro };
  if (!UUID_RE.test(coalitionId)) return { ok: false, error: "Group not found." };
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Message is empty." };
  if (body.length > MAX_BODY) return { ok: false, error: `Message is too long (${MAX_BODY} characters max).` };
  if (FLOOD_RE.test(body)) return { ok: false, error: "Looks like a stuck key. Message not sent." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to chat." };

  if (!(await checkRateLimit(`coalition:chat:${user.id}`, 10, 60))) {
    return { ok: false, error: "Slow down: 10 messages a minute." };
  }
  if (!(await checkRateLimit(`coalition:chat:day:${user.id}`, 300, 86_400))) {
    return { ok: false, error: "You've hit today's chat limit. Start a discussion on the board instead." };
  }

  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { data: dupes } = await supabase.from("coalition_chat_messages").select("id")
    .eq("user_id", user.id).eq("body", body).gte("created_at", minuteAgo).limit(1);
  if ((dupes ?? []).length > 0) return { ok: false, error: "You just sent that." };

  // RLS refuses anyone who isn't in the group.
  const { error } = await supabase.from("coalition_chat_messages")
    .insert({ coalition_id: coalitionId, user_id: user.id, body });
  if (error) return { ok: false, error: "Only members of this group can chat here." };
  return { ok: true };
}

/** Your own line, or anyone's for the group's organizers (RLS decides). */
export async function deleteGroupChat(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Not found." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in." };
  // RLS turns a delete you may not make into a silent no-op, so count the rows.
  const { data, error } = await supabase.from("coalition_chat_messages").delete().eq("id", id).select("id");
  if (error || !data?.length) return { ok: false, error: "You can't delete that message." };
  return { ok: true };
}

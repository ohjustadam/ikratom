"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

/**
 * Set the user's public key (called from client after keypair generation).
 * Idempotent — overwrites any existing value.
 */
export async function setPublicKey(publicKeyB64: string) {
  if (!publicKeyB64 || publicKeyB64.length > 200) {
    return { error: "Invalid public key." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("profiles")
    .update({ public_key: publicKeyB64 })
    .eq("id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Get the public key for one or more users (for new conversations). */
export async function getPublicKeys(userIds: string[]) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, public_key")
    .in("id", userIds);
  return Object.fromEntries(
    (data ?? [])
      .filter((r) => r.public_key)
      .map((r) => [r.id, r.public_key as string])
  );
}

/**
 * Search users by email or name (for "start a conversation" pickers).
 * Returns minimal profile info — never email body or address.
 */
export async function searchUsers(query: string, limit = 10) {
  const q = query.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, state, public_key")
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .not("public_key", "is", null)
    .limit(limit);
  return data ?? [];
}

/**
 * Create a new 1:1 conversation. Caller must have already encrypted the
 * session key for both participants client-side.
 */
export async function createConversation(input: {
  recipientUserId: string;
  encryptedSessionKeys: Record<string, string>;
  sessionKeyNonces: Record<string, string>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (input.recipientUserId === user.id) return { error: "Can't message yourself." };

  // Rate-limit: 10 new conversations/hour/user, 30/hour/IP.
  // sendMessage already has its own DB-side rate limit; this prevents
  // an account-takeover from spamming unique conversations to every
  // user (which would bypass the per-message limit).
  const ip = await getClientIp();
  if (!(await checkRateLimit(`dm:create:user:${user.id}`, 10, 3600))) {
    return { error: "You've started a lot of conversations recently. Try again in an hour." };
  }
  if (!(await checkRateLimit(`dm:create:ip:${ip}`, 30, 3600))) {
    return { error: "Too many new conversations from this network." };
  }

  // Check if a 1:1 conversation already exists between these users
  const { data: mine } = await supabase
    .from("dm_participants")
    .select("conversation_id")
    .eq("user_id", user.id);
  const myConvIds = (mine ?? []).map((r) => r.conversation_id);

  if (myConvIds.length > 0) {
    const { data: shared } = await supabase
      .from("dm_participants")
      .select("conversation_id")
      .eq("user_id", input.recipientUserId)
      .in("conversation_id", myConvIds);
    if (shared && shared.length > 0) {
      // Return existing
      return { ok: true, conversationId: shared[0].conversation_id, existing: true };
    }
  }

  // Create new conversation
  const { data: conv, error: convErr } = await supabase
    .from("dm_conversations")
    .insert({
      encrypted_session_keys: input.encryptedSessionKeys,
      session_key_nonces: input.sessionKeyNonces,
      session_key_sender_id: user.id,
    })
    .select("id")
    .single();
  if (convErr) return { error: convErr.message };

  // Snapshot both participants' current public keys for key-change detection
  const { data: keyRows } = await supabase
    .from("profiles")
    .select("id, public_key")
    .in("id", [user.id, input.recipientUserId]);
  const pkByUser: Record<string, string | null> = {};
  for (const r of keyRows ?? []) pkByUser[r.id] = r.public_key;

  const { error: partsErr } = await supabase.from("dm_participants").insert([
    { conversation_id: conv.id, user_id: user.id, pubkey_at_join: pkByUser[user.id] ?? null },
    { conversation_id: conv.id, user_id: input.recipientUserId, pubkey_at_join: pkByUser[input.recipientUserId] ?? null },
  ]);
  if (partsErr) {
    // Best-effort cleanup
    await supabase.from("dm_conversations").delete().eq("id", conv.id);
    return { error: partsErr.message };
  }

  return { ok: true, conversationId: conv.id, existing: false };
}

/** Send a pre-encrypted message to a conversation. */
export async function sendMessage(input: {
  conversationId: string;
  ciphertext: string;
  nonce: string;
}) {
  if (!input.ciphertext || !input.nonce) return { error: "Missing ciphertext." };
  if (input.ciphertext.length > 100_000) return { error: "Message too long." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Server-side rate limit (anti-spam)
  const { data: rateOk } = await supabase.rpc("check_dm_rate_limit", { p_user_id: user.id });
  if (rateOk === false) {
    return { error: "You're sending too fast. Wait a minute and try again." };
  }

  const { error } = await supabase.from("dm_messages").insert({
    conversation_id: input.conversationId,
    sender_id: user.id,
    ciphertext: input.ciphertext,
    nonce: input.nonce,
  });
  if (error) {
    // RLS may reject due to a block — surface a clearer message
    if (error.code === "42501" || /policy/i.test(error.message)) {
      return { error: "This message couldn't be delivered. The recipient may have blocked you." };
    }
    return { error: error.message };
  }

  revalidatePath(`/messages/${input.conversationId}`);
  return { ok: true };
}

/** List the user's conversations with metadata + last message timestamp. */
export async function listConversations() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Conversations I'm a participant of
  const { data: parts } = await supabase
    .from("dm_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id);
  if (!parts || parts.length === 0) return [];

  const ids = parts.map((p) => p.conversation_id);
  const lastReadByConv = Object.fromEntries(parts.map((p) => [p.conversation_id, p.last_read_at]));

  const { data: convs } = await supabase
    .from("dm_conversations")
    .select("id, last_message_at, encrypted_session_keys, session_key_nonces, session_key_sender_id, is_group, name")
    .in("id", ids)
    .order("last_message_at", { ascending: false });

  // Other participants for each conversation (for display)
  const { data: otherParts } = await supabase
    .from("dm_participants")
    .select("conversation_id, user_id")
    .in("conversation_id", ids)
    .neq("user_id", user.id);

  const otherUserIds = Array.from(new Set((otherParts ?? []).map((p) => p.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, state, public_key")
    .in("id", otherUserIds);
  const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  const otherByConv: Record<string, string[]> = {};
  for (const op of otherParts ?? []) {
    if (!otherByConv[op.conversation_id]) otherByConv[op.conversation_id] = [];
    otherByConv[op.conversation_id].push(op.user_id);
  }

  // Unread counts per conv
  const unread: Record<string, number> = {};
  for (const c of convs ?? []) {
    const lastRead = lastReadByConv[c.id];
    const since = lastRead ?? "1970-01-01";
    const { count } = await supabase
      .from("dm_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", c.id)
      .neq("sender_id", user.id)
      .gt("created_at", since);
    unread[c.id] = count ?? 0;
  }

  return (convs ?? []).map((c) => {
    const otherIds = otherByConv[c.id] ?? [];
    const others = otherIds.map((id) => profileById[id]).filter(Boolean);
    return {
      id: c.id,
      last_message_at: c.last_message_at,
      others,
      is_group: !!c.is_group,
      name: c.name as string | null,
      encrypted_session_key_for_me: (c.encrypted_session_keys as Record<string, string>)?.[user.id] ?? null,
      session_key_nonce_for_me: (c.session_key_nonces as Record<string, string>)?.[user.id] ?? null,
      session_key_sender_id: c.session_key_sender_id,
      unread: unread[c.id] ?? 0,
    };
  });
}

/** Get one conversation's metadata + messages. */
export async function getConversation(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: conv } = await supabase
    .from("dm_conversations")
    .select("id, last_message_at, encrypted_session_keys, session_key_nonces, session_key_sender_id")
    .eq("id", conversationId)
    .single();
  if (!conv) return null;

  const { data: parts } = await supabase
    .from("dm_participants")
    .select("user_id, last_read_at")
    .eq("conversation_id", conversationId);

  const otherIds = (parts ?? []).filter((p) => p.user_id !== user.id).map((p) => p.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, state, public_key")
    .in("id", otherIds);

  const { data: messages } = await supabase
    .from("dm_messages")
    .select("id, sender_id, ciphertext, nonce, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);

  return {
    id: conv.id,
    others: profiles ?? [],
    encrypted_session_key_for_me: (conv.encrypted_session_keys as Record<string, string>)?.[user.id] ?? null,
    session_key_nonce_for_me: (conv.session_key_nonces as Record<string, string>)?.[user.id] ?? null,
    session_key_sender_id: conv.session_key_sender_id,
    messages: messages ?? [],
    my_user_id: user.id,
  };
}

/** Mark a conversation as read up to "now". */
export async function markConversationRead(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  const { error } = await supabase
    .from("dm_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  return { ok: true };
}

/** Total unread DM count across all conversations (for header bell). */
export async function getUnreadDmCount(): Promise<number> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data: parts } = await supabase
    .from("dm_participants")
    .select("conversation_id, last_read_at")
    .eq("user_id", user.id);

  if (!parts || parts.length === 0) return 0;

  let total = 0;
  for (const p of parts) {
    const since = p.last_read_at ?? "1970-01-01";
    const { count } = await supabase
      .from("dm_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", p.conversation_id)
      .neq("sender_id", user.id)
      .gt("created_at", since);
    total += count ?? 0;
  }
  return total;
}

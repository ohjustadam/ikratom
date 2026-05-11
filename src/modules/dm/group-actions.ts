"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Create a new GROUP conversation. The caller has already encrypted the
 * session key for every initial member (including themselves) client-side.
 */
export async function createGroupConversation(input: {
  name: string;
  description?: string;
  memberIds: string[];                        // includes caller
  encryptedSessionKeys: Record<string, string>;
  sessionKeyNonces: Record<string, string>;
  pubkeySnapshots: Record<string, string>;    // public_key at time of join, per member
}) {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { error: "Group name is required." };
  if (input.memberIds.length < 2) return { error: "Add at least one other member." };
  if (input.memberIds.length > 50) return { error: "Groups capped at 50 members." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };
  if (!input.memberIds.includes(user.id)) {
    return { error: "Caller must be in memberIds." };
  }

  // Create conversation
  const { data: conv, error: convErr } = await supabase
    .from("dm_conversations")
    .insert({
      is_group: true,
      name,
      description: (input.description ?? "").slice(0, 500) || null,
      created_by: user.id,
      session_key_sender_id: user.id,
      encrypted_session_keys: input.encryptedSessionKeys,
      session_key_nonces: input.sessionKeyNonces,
    })
    .select("id")
    .single();
  if (convErr) return { error: convErr.message };

  // Add participants — creator is owner, rest are members
  const partRows = input.memberIds.map((uid) => ({
    conversation_id: conv.id,
    user_id: uid,
    role: uid === user.id ? "owner" : "member",
    pubkey_at_join: input.pubkeySnapshots[uid] ?? null,
  }));
  const { error: partErr } = await supabase.from("dm_participants").insert(partRows);
  if (partErr) {
    await supabase.from("dm_conversations").delete().eq("id", conv.id);
    return { error: partErr.message };
  }

  return { ok: true, conversationId: conv.id };
}

/**
 * Returns the data the caller needs to decrypt THEIR slot of the
 * conversation's session key — so they can re-encrypt the raw
 * session key for a new group member. Used by the "Add member"
 * flow on /messages/[id]/settings.
 *
 * Caller flow:
 *   1. Call this → get {ciphertextB64, nonceB64, senderPublicKeyB64}
 *   2. decryptSessionKeyForMe(...) using their own private key
 *   3. encryptSessionKeyForRecipient(...) using the new member's pubkey
 *   4. Call addGroupMember(...) with the new ciphertext + nonce
 */
export async function getMyConversationKeyData(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: conv } = await supabase
    .from("dm_conversations")
    .select("encrypted_session_keys, session_key_nonces, session_key_sender_id")
    .eq("id", conversationId)
    .single();
  if (!conv) return { error: "Conversation not found." };

  const keys = (conv.encrypted_session_keys as Record<string, string>) ?? {};
  const nonces = (conv.session_key_nonces as Record<string, string>) ?? {};
  const myCiphertext = keys[user.id];
  const myNonce = nonces[user.id];
  if (!myCiphertext || !myNonce) return { error: "You don't have a key slot in this conversation." };

  const senderId = (conv as { session_key_sender_id?: string }).session_key_sender_id;
  if (!senderId) return { error: "Conversation missing sender_id (legacy data?)." };

  // Look up sender's pubkey via their participant snapshot (pubkey_at_join)
  // falling back to current public_key
  const { data: senderPart } = await supabase
    .from("dm_participants")
    .select("pubkey_at_join")
    .eq("conversation_id", conversationId)
    .eq("user_id", senderId)
    .maybeSingle();
  let senderPublicKeyB64 = (senderPart as { pubkey_at_join?: string } | null)?.pubkey_at_join;
  if (!senderPublicKeyB64) {
    const { data: senderProf } = await supabase
      .from("profiles")
      .select("public_key")
      .eq("id", senderId)
      .single();
    senderPublicKeyB64 = (senderProf as { public_key?: string } | null)?.public_key ?? undefined;
  }
  if (!senderPublicKeyB64) return { error: "Sender public key missing." };

  return {
    ok: true as const,
    ciphertextB64: myCiphertext,
    nonceB64: myNonce,
    senderPublicKeyB64,
  };
}

/**
 * Add a new member to an existing group. The caller (an existing member)
 * must have re-encrypted the current session key for the new member's public key
 * client-side and pass the ciphertext + nonce here.
 */
export async function addGroupMember(input: {
  conversationId: string;
  newMemberId: string;
  encryptedSessionKeyForNewMember: string;
  nonce: string;
  newMemberPubkey: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Caller must be an existing participant with admin/owner role (or any member — pick policy)
  const { data: callerPart } = await supabase
    .from("dm_participants")
    .select("role")
    .eq("conversation_id", input.conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!callerPart) return { error: "You're not in this group." };
  if (!["owner", "admin"].includes(callerPart.role)) {
    return { error: "Only owners and admins can add members." };
  }

  // Add to participants table
  const { error: pErr } = await supabase.from("dm_participants").insert({
    conversation_id: input.conversationId,
    user_id: input.newMemberId,
    role: "member",
    pubkey_at_join: input.newMemberPubkey,
  });
  if (pErr) return { error: pErr.message };

  // Update encrypted_session_keys + nonces JSONB to add the new member's slot
  const { data: conv } = await supabase
    .from("dm_conversations")
    .select("encrypted_session_keys, session_key_nonces")
    .eq("id", input.conversationId)
    .single();
  if (!conv) return { error: "Conversation not found." };

  const keys = { ...(conv.encrypted_session_keys as Record<string, string>) };
  const nonces = { ...(conv.session_key_nonces as Record<string, string>) };
  keys[input.newMemberId] = input.encryptedSessionKeyForNewMember;
  nonces[input.newMemberId] = input.nonce;

  const { error: cErr } = await supabase
    .from("dm_conversations")
    .update({ encrypted_session_keys: keys, session_key_nonces: nonces })
    .eq("id", input.conversationId);
  if (cErr) return { error: cErr.message };

  revalidatePath(`/messages/${input.conversationId}`);
  return { ok: true };
}

/**
 * Remove a member from a group. NOTE: this does not rotate the session key —
 * the removed member could still decrypt past messages they've already seen.
 * For v1 this is a documented limitation. Future: trigger key rotation on remove.
 */
export async function removeGroupMember(input: {
  conversationId: string;
  memberId: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: callerPart } = await supabase
    .from("dm_participants")
    .select("role")
    .eq("conversation_id", input.conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!callerPart) return { error: "You're not in this group." };

  // Self-leave is fine; otherwise need owner/admin
  if (input.memberId !== user.id && !["owner", "admin"].includes(callerPart.role)) {
    return { error: "Only owners and admins can remove others." };
  }

  // Owner can't be removed (must transfer first)
  if (input.memberId !== user.id) {
    const { data: targetPart } = await supabase
      .from("dm_participants")
      .select("role")
      .eq("conversation_id", input.conversationId)
      .eq("user_id", input.memberId)
      .maybeSingle();
    if (targetPart?.role === "owner") return { error: "Can't remove the owner." };
  }

  const { error } = await supabase
    .from("dm_participants")
    .delete()
    .eq("conversation_id", input.conversationId)
    .eq("user_id", input.memberId);
  if (error) return { error: error.message };

  revalidatePath(`/messages/${input.conversationId}`);
  return { ok: true };
}

/** Rename or update group description. */
export async function updateGroup(input: {
  conversationId: string;
  name?: string;
  description?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: callerPart } = await supabase
    .from("dm_participants")
    .select("role")
    .eq("conversation_id", input.conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!callerPart || !["owner", "admin"].includes(callerPart.role)) {
    return { error: "Only owners and admins can rename." };
  }

  const update: { name?: string; description?: string | null } = {};
  if (input.name !== undefined) {
    const n = input.name.trim().slice(0, 80);
    if (!n) return { error: "Name can't be empty." };
    update.name = n;
  }
  if (input.description !== undefined) {
    update.description = input.description.trim().slice(0, 500) || null;
  }

  const { error } = await supabase
    .from("dm_conversations")
    .update(update)
    .eq("id", input.conversationId);
  if (error) return { error: error.message };
  revalidatePath(`/messages/${input.conversationId}`);
  return { ok: true };
}

/** Get group details including members + their current public keys (for key-change detection). */
export async function getGroupDetails(conversationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: conv } = await supabase
    .from("dm_conversations")
    .select("id, is_group, name, description, created_by, created_at")
    .eq("id", conversationId)
    .single();
  if (!conv) return null;

  const { data: parts } = await supabase
    .from("dm_participants")
    .select("user_id, role, joined_at, pubkey_at_join")
    .eq("conversation_id", conversationId);
  if (!parts) return null;

  const userIds = parts.map((p) => p.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, state, public_key")
    .in("id", userIds);
  const profilesById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]));

  // Detect key changes
  const members = parts.map((p) => {
    const prof = profilesById[p.user_id];
    const keyChanged = !!(p.pubkey_at_join && prof?.public_key && p.pubkey_at_join !== prof.public_key);
    return {
      user_id: p.user_id,
      full_name: prof?.full_name ?? null,
      email: prof?.email ?? null,
      state: prof?.state ?? null,
      role: p.role,
      joined_at: p.joined_at,
      key_changed: keyChanged,
    };
  });

  const myPart = parts.find((p) => p.user_id === user.id);
  return {
    ...conv,
    members,
    my_role: myPart?.role ?? null,
  };
}

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getConversation, markConversationRead } from "@/modules/dm/actions";
import { getGroupDetails } from "@/modules/dm/group-actions";
import { ConversationView } from "./ConversationView";

export const metadata = { title: "Message" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/messages/${id}`);

  const conv = await getConversation(id);
  if (!conv) notFound();

  await markConversationRead(id);

  // Sender's public key for session-key decryption
  let senderPublicKey: string | null = null;
  if (conv.session_key_sender_id) {
    const { data: senderProf } = await supabase
      .from("profiles")
      .select("public_key")
      .eq("id", conv.session_key_sender_id)
      .single();
    senderPublicKey = senderProf?.public_key ?? null;
  }

  // Pull is_group + group metadata + key-change snapshots
  const { data: convMeta } = await supabase
    .from("dm_conversations")
    .select("is_group, name, description")
    .eq("id", id)
    .single();

  const groupDetails = convMeta?.is_group ? await getGroupDetails(id) : null;

  // For 1:1 conversations: detect if the other person's public key changed since this convo started
  let keyChanged = false;
  if (!convMeta?.is_group && conv.others.length === 1) {
    const other = conv.others[0];
    const { data: myPart } = await supabase
      .from("dm_participants")
      .select("pubkey_at_join")
      .eq("conversation_id", id)
      .eq("user_id", other.id)
      .maybeSingle();
    if (myPart?.pubkey_at_join && other.public_key && myPart.pubkey_at_join !== other.public_key) {
      keyChanged = true;
    }
  }

  return (
    <ConversationView
      conversationId={conv.id}
      myUserId={conv.my_user_id}
      others={conv.others}
      isGroup={!!convMeta?.is_group}
      groupName={convMeta?.name ?? null}
      groupMembers={groupDetails?.members ?? null}
      myRoleInGroup={groupDetails?.my_role ?? null}
      keyChanged={keyChanged}
      encryptedSessionKey={conv.encrypted_session_key_for_me}
      sessionKeyNonce={conv.session_key_nonce_for_me}
      senderPublicKey={senderPublicKey}
      messages={conv.messages}
    />
  );
}

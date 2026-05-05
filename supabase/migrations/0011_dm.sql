-- ============================================================
-- 0011 — Direct Messages (E2E encrypted, 1:1 first)
-- ============================================================
-- All message bodies are stored as ciphertext (base64). The server NEVER
-- sees plaintext. Each conversation has a symmetric session key that's
-- encrypted with each participant's public key (stored on the conversation row).
--
-- Trust-on-first-use (TOFU): when user A first messages B, A pulls B's public
-- key from profiles.public_key. If B's key later changes, the UI surfaces a
-- soft warning — but never blocks. Optional manual fingerprint verification
-- lives in /account (out-of-band).

create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- Encrypted session keys per participant. JSONB: { "<user_id>": "<base64-ciphertext>" }
  -- Each entry is the symmetric session key encrypted with that user's public key
  -- via libsodium's box (Curve25519 + XSalsa20-Poly1305).
  encrypted_session_keys jsonb not null default '{}'::jsonb,
  -- The user_id of whoever the session_key sender is (for box's "from" side)
  session_key_sender_id uuid references auth.users(id) on delete set null,
  -- Per-conversation key generation nonce (for the box encryption above)
  session_key_nonces jsonb not null default '{}'::jsonb
);

-- Participants table — 1:1 for now, but designed for group expansion
create table if not exists public.dm_participants (
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists dm_participants_user_idx
  on public.dm_participants(user_id, conversation_id);

-- Messages — ciphertext + nonce. Server never sees plaintext.
create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,                          -- base64
  nonce text not null,                                -- base64, 24 bytes for XChaCha20
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_conversation_time_idx
  on public.dm_messages(conversation_id, created_at desc);

-- Trigger: update conversation.last_message_at on new message
create or replace function public.trg_dm_message_inserted()
returns trigger language plpgsql as $$
begin
  update public.dm_conversations
    set last_message_at = now()
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists dm_message_inserted on public.dm_messages;
create trigger dm_message_inserted
  after insert on public.dm_messages
  for each row execute function public.trg_dm_message_inserted();

-- ============================================================
-- RLS
-- ============================================================
alter table public.dm_conversations enable row level security;
alter table public.dm_participants enable row level security;
alter table public.dm_messages enable row level security;

-- Conversations: read if you're a participant
drop policy if exists "dm_conv_participant_read" on public.dm_conversations;
create policy "dm_conv_participant_read" on public.dm_conversations
  for select using (
    exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_conversations.id and p.user_id = auth.uid()
    )
  );

-- Conversations: only authenticated users can create. Then they MUST add
-- themselves as a participant in the same transaction (handled server-side).
drop policy if exists "dm_conv_authed_insert" on public.dm_conversations;
create policy "dm_conv_authed_insert" on public.dm_conversations
  for insert with check (auth.uid() is not null);

drop policy if exists "dm_conv_participant_update" on public.dm_conversations;
create policy "dm_conv_participant_update" on public.dm_conversations
  for update using (
    exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_conversations.id and p.user_id = auth.uid()
    )
  );

-- Participants: read if you're in the conversation
drop policy if exists "dm_part_self_read" on public.dm_participants;
create policy "dm_part_self_read" on public.dm_participants
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_participants.conversation_id and p.user_id = auth.uid()
    )
  );

-- Participants: user can insert themselves OR the conversation creator can add others
drop policy if exists "dm_part_insert" on public.dm_participants;
create policy "dm_part_insert" on public.dm_participants
  for insert with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_participants.conversation_id and p.user_id = auth.uid()
    )
  );

-- Participants: user can update their own row (mark as read)
drop policy if exists "dm_part_self_update" on public.dm_participants;
create policy "dm_part_self_update" on public.dm_participants
  for update using (user_id = auth.uid());

-- Messages: read if you're a participant in the conversation
drop policy if exists "dm_msg_participant_read" on public.dm_messages;
create policy "dm_msg_participant_read" on public.dm_messages
  for select using (
    exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_messages.conversation_id and p.user_id = auth.uid()
    )
  );

-- Messages: send only if you're a participant + sender_id matches you
drop policy if exists "dm_msg_participant_insert" on public.dm_messages;
create policy "dm_msg_participant_insert" on public.dm_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_messages.conversation_id and p.user_id = auth.uid()
    )
  );

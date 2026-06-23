-- ============================================================
-- 0216 — DM RLS hardening (pen-test DM-01 / DM-02 / DM-03)
-- ============================================================
-- All DM mutations run through the USER's session client (src/modules/dm/*),
-- so RLS is the real boundary. Three gaps, all from `using(...)` policies with
-- no WITH CHECK / no column restriction (Postgres RLS can't restrict columns):
--
--   DM-01 (HIGH): dm_conversations UPDATE (0011:91) — any participant could
--     overwrite encrypted_session_keys/nonces/sender_id, swapping the E2E
--     session key to one they hold → silent MITM/eavesdrop of all future
--     plaintext (no UI signal), or zero it to brick the conversation.
--   DM-02 (HIGH): dm_participants self-update (0011:123) — a group `member`
--     could PATCH their own row to role='owner' (self-promotion) or repoint
--     conversation_id to join a conversation they were never in.
--   DM-03 (MED): dm_participants INSERT (0011:112) `with check (user_id =
--     auth.uid() OR exists(participant…))` — a participant could add an
--     arbitrary 3rd user to a 1:1, and a user could self-add to ANY conversation.
--
-- Legit flows (verified in src/modules/dm/): startConversation + createGroup
-- seed the conversation (created_by set — startConversation now sets it too) and
-- INSERT participants; addGroupMember (owner/admin) INSERTs a member + UPDATEs
-- the key map; NO flow ever UPDATEs role/conversation_id. Service-role isn't used.
--
-- Rollback: drop the two triggers+functions; restore the 0011 dm_part_insert policy.

-- ── DM-01: only an owner/admin participant (or service-role) may change the
--           E2E session-key columns. Plain members can't swap/zero the key.
create or replace function public.guard_dm_conversation_keys()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service-role / cron
  -- Key columns unchanged (e.g. rename/description, trigger-maintained
  -- last_message_at) → always allowed.
  if new.encrypted_session_keys   is not distinct from old.encrypted_session_keys
     and new.session_key_nonces    is not distinct from old.session_key_nonces
     and new.session_key_sender_id is not distinct from old.session_key_sender_id then
    return new;
  end if;
  -- Key columns changed: only an owner/admin of this conversation may do it
  -- (the legitimate add-member re-key path). A plain member is blocked.
  if exists (
    select 1 from public.dm_participants p
    where p.conversation_id = new.id and p.user_id = auth.uid()
      and p.role in ('owner', 'admin')
  ) then
    return new;
  end if;
  raise exception 'not authorized to modify conversation session keys';
end;
$$;
drop trigger if exists trg_guard_dm_conversation_keys on public.dm_conversations;
create trigger trg_guard_dm_conversation_keys
  before update on public.dm_conversations
  for each row execute function public.guard_dm_conversation_keys();

-- ── DM-02: a participant may update only benign columns of their own row
--           (last_read_at). role / conversation_id / user_id are immutable to
--           end users — no app flow changes them; only service-role could.
create or replace function public.guard_dm_participant_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service-role
  if new.role            is distinct from old.role
     or new.conversation_id is distinct from old.conversation_id
     or new.user_id         is distinct from old.user_id then
    raise exception 'not authorized to change participant role or membership';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_dm_participant_update on public.dm_participants;
create trigger trg_guard_dm_participant_update
  before update on public.dm_participants
  for each row execute function public.guard_dm_participant_update();

-- ── DM-03: tighten participant INSERT — only the conversation CREATOR (seeding
--           it at creation) or a group OWNER/ADMIN (adding a member) may insert.
--           Kills "self-add to any conversation" + "participant adds an arbitrary
--           3rd party". The creator is matched by created_by OR session_key_sender_id
--           — the latter is ALSO set by the current live startConversation/createGroup,
--           so this is safe to apply regardless of code-deploy order (no window where
--           a created_by-less 1:1 can't seed its participants). Both are immutable to
--           non-owners (session_key_sender_id is guarded by the DM-01 trigger above).
drop policy if exists "dm_part_insert" on public.dm_participants;
create policy "dm_part_insert" on public.dm_participants
  for insert with check (
    exists (
      select 1 from public.dm_conversations c
      where c.id = dm_participants.conversation_id
        and (c.created_by = auth.uid() or c.session_key_sender_id = auth.uid())
    )
    or exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_participants.conversation_id
        and p.user_id = auth.uid()
        and p.role in ('owner', 'admin')
    )
  );

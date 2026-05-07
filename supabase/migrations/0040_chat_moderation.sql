-- ============================================================
-- 0040_chat_moderation
--
-- Adds chat-level mute and tightens the lounge insert policy. Lets owners
-- and admins manage the Lounge from the admin portal without touching
-- the DB directly:
--
--   * profiles.chat_muted_until — null means not muted; a future timestamp
--     blocks chat inserts via RLS until that moment passes. Use a far-
--     future date for "permanent" (e.g. 9999-01-01).
--   * chat_messages insert policy now checks the mute window.
--   * Audit-log table already covers `mod.chat_mute` via record_admin_action.
-- ============================================================

alter table public.profiles
  add column if not exists chat_muted_until timestamptz;

-- Tighten the chat insert policy: cannot post while muted.
drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.chat_muted_until is not null
        and p.chat_muted_until > now()
    )
  );

-- Helper for the admin page to detect currently-muted users with one query.
create or replace view public.chat_muted_users as
  select id, full_name, chat_muted_until
    from public.profiles
   where chat_muted_until is not null and chat_muted_until > now();

grant select on public.chat_muted_users to authenticated;

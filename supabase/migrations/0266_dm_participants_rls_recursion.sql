-- 0266_dm_participants_rls_recursion.sql — DMs were failing for signed-in users
-- with "infinite recursion detected in policy for relation dm_participants".
--
-- Seen in production logs 2026-10-08 (13:51 and 14:44 UTC): GET
-- /dm_participants?select=conversation_id,last_read_at as an authenticated
-- user returned 500 (Postgres 42P17). The SELECT, INSERT and DELETE policies on
-- dm_participants each checked membership with a subquery ON dm_participants;
-- that subquery is itself subject to the same policy, so evaluating the policy
-- re-entered it forever.
--
-- Fix: two SECURITY DEFINER helpers answer "am I in this conversation" / "am I
-- an owner/admin of it" without going through RLS, and the policies call them.
-- Semantics are unchanged. The helpers take NO user argument — they only ever
-- answer for auth.uid() — so they can't be used to probe someone else's
-- membership.
--
-- Rollback: restore the three policies from 0216/0225 (they recurse) and
--   drop function public.dm_is_member(uuid); drop function public.dm_is_manager(uuid);

create or replace function public.dm_is_member(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_participants
    where conversation_id = p_conversation and user_id = auth.uid()
  );
$$;

create or replace function public.dm_is_manager(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.dm_participants
    where conversation_id = p_conversation and user_id = auth.uid()
      and role = any (array['owner'::text, 'admin'::text])
  );
$$;

revoke all on function public.dm_is_member(uuid) from public, anon;
revoke all on function public.dm_is_manager(uuid) from public, anon;
grant execute on function public.dm_is_member(uuid) to authenticated, service_role;
grant execute on function public.dm_is_manager(uuid) to authenticated, service_role;

drop policy if exists dm_part_self_read on public.dm_participants;
create policy dm_part_self_read on public.dm_participants
  for select to authenticated
  using (user_id = auth.uid() or public.dm_is_member(conversation_id));

drop policy if exists dm_part_delete on public.dm_participants;
create policy dm_part_delete on public.dm_participants
  for delete to authenticated
  using (user_id = auth.uid() or public.dm_is_manager(conversation_id));

drop policy if exists dm_part_insert on public.dm_participants;
create policy dm_part_insert on public.dm_participants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id
        and (c.created_by = auth.uid() or c.session_key_sender_id = auth.uid())
    )
    or public.dm_is_manager(conversation_id)
  );

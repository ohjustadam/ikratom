-- ============================================================
-- 0225 — DM participants DELETE policy (pen-test DM-04)
-- ============================================================
-- dm_participants had RLS enabled (0011) with SELECT/INSERT/UPDATE policies
-- but NO DELETE policy. Postgres RLS is default-deny, so removeGroupMember()'s
-- .delete() matched 0 rows and PostgREST returned success (empty set, no error)
-- — the "removed" member's participant row survived. dm_msg_participant_read
-- grants message SELECT purely on that row's existence, so a kicked (or
-- self-departed) group member kept reading every future message indefinitely
-- (compounded by the documented no-key-rotation limitation). This adds the
-- missing DELETE policy so removal actually takes effect.
--
-- Who may delete a dm_participants row:
--   * the user themselves (self-leave), OR
--   * an owner/admin of the same conversation (kick a member).
-- Mirrors the dm_part_insert authorization shape (0216). The app layer
-- (removeGroupMember) additionally blocks removing the conversation owner and
-- now asserts the delete affected a row.
--
-- Rollback: drop policy "dm_part_delete" on public.dm_participants;

drop policy if exists "dm_part_delete" on public.dm_participants;
create policy "dm_part_delete" on public.dm_participants
  for delete using (
    user_id = auth.uid()
    or exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_participants.conversation_id
        and p.user_id = auth.uid()
        and p.role in ('owner', 'admin')
    )
  );

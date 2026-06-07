-- 0180_state_status_incoming.sql
-- Add an "incoming" leaf-status: a protective law (KCPA / pro-kratom) that is
-- ENACTED/SIGNED but not yet IN FORCE (a future effective date). The map shows
-- it in a distinct color — "approved, not yet in law" — sitting between
-- unprotected (blue) and protected (green). Owner directive 2026-06-07: a state
-- whose protection hasn't taken effect yet must NOT read as fully protected.
--
-- When the law takes effect, the matching state_status_flips row surfaces it
-- into the confirm queue (queue-due-state-flips.mjs) and it becomes kcpa/protected.
--
-- Also seeds the Wyoming flip (SF0056 KCPA → effective Jul 1, 2026).
-- Rollback: restore the 0173 admin_leaf_status check list; delete the WY flip.

alter table public.state_status drop constraint if exists state_status_admin_leaf_status_check;
alter table public.state_status add constraint state_status_admin_leaf_status_check
  check (admin_leaf_status is null or admin_leaf_status in
    ('legal', 'kcpa', 'banned', 'restricted', 'protected', 'incoming'));

insert into public.state_status_flips (state, field, new_status, effective_date, note, source)
values
  ('WY', 'leaf', 'kcpa', '2026-07-01',
   'Wyoming Kratom Consumer Protection Act (SF0056) takes effect — protections become active.', 'WY SF0056')
on conflict (state, field, effective_date) do nothing;

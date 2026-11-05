-- 0306_group_link_max_uses.sql
--
-- The reusable group link (0274) could never be created. getGroupLink()
-- inserts it with max_uses = 100000 so one link serves a whole group, but
-- 0153's check capped every invite at 100, so the insert failed and the
-- organizer saw "Couldn't make the link. Try again." (Rein In Chaos,
-- 2026-11-02). No reusable link existed on any group.
--
-- One-time invites keep the 1..100 cap; a reusable group link may go to
-- 1,000,000 uses.
--
-- Rollback (only once no reusable row has max_uses > 100):
--   alter table public.coalition_invites drop constraint coalition_invites_max_uses_check;
--   alter table public.coalition_invites add constraint coalition_invites_max_uses_check
--     check (max_uses between 1 and 100);

alter table public.coalition_invites drop constraint if exists coalition_invites_max_uses_check;
alter table public.coalition_invites add constraint coalition_invites_max_uses_check
  check (max_uses >= 1 and max_uses <= case when reusable then 1000000 else 100 end);

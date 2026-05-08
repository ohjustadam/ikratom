-- ============================================================
-- 0058_backfill_leader_tour
--
-- One-shot backfill: every existing advocate-leader (granted
-- BEFORE we shipped the leader tour) needs the tutorial flag set,
-- and a notification dropped in their bell so they know to log in.
--
-- The notification fan-out + push pipeline runs daily, so any
-- leaders with push enabled will get a phone notification the
-- next time fan-out fires.
--
-- Idempotent: only flips rows where leader_tour_pending is still
-- false, and the notification insert is skipped if an unread
-- "role_granted_leader_backfill" notif already exists.
-- ============================================================

-- 1) Flip leader_tour_pending on for everyone who's already a leader.
update public.profiles
   set leader_tour_pending = true
 where is_advocate_leader = true
   and leader_tour_pending = false;

-- 2) Drop a one-time notification per existing leader, skipping
--    anyone who already has an unread backfill notification.
insert into public.notifications (user_id, kind, title, body, link)
select
  p.id,
  'role_granted_leader_backfill',
  '🎖 New leader tutorial available',
  'We just shipped a quick walkthrough for advocate leaders — campaign authoring, forum moderation, the leader workshop. Visit your dashboard to start it.',
  '/dashboard'
from public.profiles p
where p.is_advocate_leader = true
  and not exists (
    select 1
      from public.notifications n
     where n.user_id = p.id
       and n.kind = 'role_granted_leader_backfill'
  );

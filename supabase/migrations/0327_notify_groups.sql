-- 0327_notify_groups.sql
--
-- Owner ask 2026-11-17: group notifications follow the member's preference.
-- Until now the group kinds (coalition_discussion, coalition_event,
-- coalition_action) fell through notification_category() to 'other', which no
-- toggle gates. The only way to quiet a busy group was to turn off every
-- notification.
--
-- Adds notify_groups. It defaults to on, so nobody's notices change until they
-- choose. Maps the group kinds to a 'groups' category and teaches the
-- before-insert gate about it. A muted member gets no inbox row, so no push and
-- no email either: both read the inbox.
--
-- Deliberately NOT gated, as before:
--   * coalition_join_request: an organizer's queue, and the requester's "you're
--     in". Approvals are never muted, like role_granted_*.
--   * mention: one person talking to another (Lounge and group chat alike).
--
-- Both functions are the live definitions (0268 and 0211) with one line added each.
--
-- Rollback:
--   re-run the 0268 notification_category and the 0211 notifications_category_gate,
--   then: alter table public.notification_preferences drop column notify_groups;

alter table public.notification_preferences
  add column if not exists notify_groups boolean not null default true;

comment on column public.notification_preferences.notify_groups is
  'Group discussions, replies, events and group actions (category ''groups''). Join requests and @mentions are never gated.';

create or replace function public.notification_category(p_kind text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case
    when p_kind in ('bill_action','bill_status','bill_status_change') then 'bills'
    when p_kind in ('reps_added') then 'local_reps'
    -- 'national_news' added 2026-09-20 with the country-wide digest.
    when p_kind in ('state_news','policy_alert','national_news') then 'news'
    when p_kind in ('meeting','meeting_reminder','meeting_upcoming','meeting_live','bill_meeting_reminder','bop_hearing') then 'meetings'
    when p_kind in ('forum_new_thread','forum_reply','thread_reply','post_reply') then 'community'
    -- 0327: groups the member joined. Join requests and mentions stay 'other'.
    when p_kind in ('coalition_discussion','coalition_event','coalition_action') then 'groups'
    when p_kind in ('whats_new','gmail_connect_nudge','state_briefing_welcome') then 'announcements'
    -- campaigns keep their dedicated notify_*_campaigns gating in
    -- notify_users_for_campaign. Security/personal kinds (new_device,
    -- role_granted_*, intel_tip_approved/rejected, wave_fired) and
    -- admin/owner ops alerts (bop_*, state_flip) are never gated.
    else 'other'
  end;
$function$;

create or replace function public.notifications_category_gate()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cat text;
  v_muted boolean := false;
begin
  v_cat := public.notification_category(new.kind);
  if v_cat = 'other' then return new; end if;
  select case v_cat
           when 'bills' then not np.notify_bills
           when 'local_reps' then not np.notify_local_reps
           when 'news' then not np.notify_news
           when 'meetings' then not np.notify_meetings
           when 'voting_reminder' then not np.notify_voting_reminder
           when 'state_briefings' then not np.notify_state_briefings
           when 'community' then not np.notify_community
           when 'groups' then not np.notify_groups
           when 'announcements' then not np.notify_announcements
           else false
         end
    into v_muted
    from public.notification_preferences np
   where np.user_id = new.user_id;
  if coalesce(v_muted, false) then return null; end if;
  return new;
exception when others then
  return new; -- fail open — a gate bug must never block notifications
end;
$function$;

-- 0211_state_briefing_notifications.sql — "daily state briefing" notification
-- category (opt-out, default ON), matching the 0194/0200 pattern.
--
-- The 51 nightly AI field-work briefings (state_briefings) now have a public
-- surface + Kokoro "Listen" (#650). This adds the per-user opt-out toggle so
-- users can choose whether to be notified about their state's briefing, and
-- wires a `state_briefing` notification kind through the 0194 category gate so
-- a future recurring driver is silenced for users who opt out — at the single
-- BEFORE INSERT chokepoint, covering both the buzz and the inbox row.
--
-- Default ON (opt-out) like every 0194/0200 category. Fails OPEN (a gate bug
-- must never block a notification insert).
--
-- NOTE: the one-time launch announcement uses kind='whats_new' (the
-- 'announcements' category), NOT this one — so it reaches everyone. This new
-- category gates the *recurring* per-state briefing notifications only.
--
-- Rollback:
--   alter table public.notification_preferences drop column if exists notify_state_briefings;
--   -- then revert notification_category()/notifications_category_gate() to their 0200 bodies.

-- 1. New opt-out category column (default ON, opt-out model — matches 0194/0200).
alter table public.notification_preferences
  add column if not exists notify_state_briefings boolean not null default true;

-- 2. Extend the kind→category map (0194/0200) with the state_briefing kind.
--    'state_briefing_welcome' stays in 'announcements' (it's a one-time welcome,
--    not the recurring briefing notification).
create or replace function public.notification_category(p_kind text)
returns text
language sql
immutable
as $$
  select case
    when p_kind in ('bill_action','bill_status','bill_status_change') then 'bills'
    when p_kind in ('reps_added') then 'local_reps'
    when p_kind in ('state_news','policy_alert') then 'news'
    when p_kind in ('meeting','meeting_reminder','meeting_upcoming','meeting_live','bill_meeting_reminder','bop_hearing') then 'meetings'
    when p_kind in ('voting_reminder') then 'voting_reminder'
    when p_kind in ('state_briefing','state_briefing_updated') then 'state_briefings'
    when p_kind in ('forum_new_thread','forum_reply','thread_reply','post_reply') then 'community'
    when p_kind in ('whats_new','gmail_connect_nudge','state_briefing_welcome') then 'announcements'
    else 'other'
  end;
$$;

-- 3. Extend the BEFORE INSERT gate with the state_briefings arm. CREATE OR
--    REPLACE keeps the existing trigger binding. Same fail-open shape as 0194/0200.
create or replace function public.notifications_category_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

comment on column public.notification_preferences.notify_state_briefings is
  'Opt-out of state daily field-work briefing notifications (kind=state_briefing). Default on. Gated at the notifications BEFORE INSERT trigger.';

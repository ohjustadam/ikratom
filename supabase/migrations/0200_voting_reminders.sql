-- 0200_voting_reminders.sql — election voting reminders (#19 PR 2).
--
-- Adds a "voting_reminder" notification category (per-user opt-out, default
-- ON, like the 0194 set) + the per-election dedup stamps that
-- scripts/fire-voting-reminders.mjs writes. Reminders fire T-30 / T-7 / T-1
-- days before EVERY approved row in election_dates (0199), geofenced:
--   • national-scope elections (the general) → all users
--   • state-scope elections (primaries/runoffs) → users whose profiles.state matches
-- DND/quiet-hours are respected by the existing push path; the category gate
-- below silences muted users at the notifications insert (both buzz + inbox).
--
-- Rollback:
--   alter table public.notification_preferences drop column if exists notify_voting_reminder;
--   alter table public.election_dates
--     drop column if exists reminder_30d_sent_at,
--     drop column if exists reminder_7d_sent_at,
--     drop column if exists reminder_1d_sent_at;
--   -- then revert notification_category()/notifications_category_gate() to their 0194 bodies.

-- 1. New opt-out category column (default ON, opt-out model — matches 0194).
alter table public.notification_preferences
  add column if not exists notify_voting_reminder boolean not null default true;

-- 2. Per-election reminder dedup stamps (one per window). NULL = not yet sent;
--    the cron stamps after firing so the next run skips it.
alter table public.election_dates
  add column if not exists reminder_30d_sent_at timestamptz,
  add column if not exists reminder_7d_sent_at timestamptz,
  add column if not exists reminder_1d_sent_at timestamptz;

-- 3. Extend the kind→category map (0194) with voting_reminder.
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
    when p_kind in ('forum_new_thread','forum_reply','thread_reply','post_reply') then 'community'
    when p_kind in ('whats_new','gmail_connect_nudge','state_briefing_welcome') then 'announcements'
    else 'other'
  end;
$$;

-- 4. Extend the BEFORE INSERT gate with the voting_reminder arm. CREATE OR
--    REPLACE keeps the existing trigger binding. Same fail-open shape as 0194:
--    any error returns NEW so a gate bug can never block a notification.
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

comment on column public.notification_preferences.notify_voting_reminder is
  'Opt-out of election voting reminders (T-30/7/1 before primaries + the general). Default on. Gated at the notifications BEFORE INSERT trigger.';

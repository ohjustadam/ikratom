-- 0251_national_news_digest.sql
--
-- Adds the 'national_news' notification kind to the 'news' category.
--
-- WHY THIS MIGRATION EXISTS AT ALL. push-national-news-digest.mjs sends a single
-- daily digest of kratom news from OTHER states plus national coverage — the
-- counterpart to push-state-news.mjs, which only ever reaches in-state users.
-- notification_category() is the chokepoint that honours the user's
-- notify_news toggle, and it matches on an explicit kind list. A kind it does
-- not know falls through to 'other', and 'other' is DELIVERED UNGATED — so
-- shipping the digest without this line would push it to people who had
-- already switched news notifications off. That is the opposite of an opt-out.
--
-- Nothing else changes: same function, same categories, one kind added.
--
-- Rollback: re-run the 0194 body of notification_category() (this file's
-- previous definition, without 'national_news').

create or replace function public.notification_category(p_kind text)
returns text
language sql
immutable
as $$
  select case
    when p_kind in ('bill_action','bill_status','bill_status_change') then 'bills'
    when p_kind in ('reps_added') then 'local_reps'
    -- 'national_news' added 2026-09-20 with the country-wide digest.
    when p_kind in ('state_news','policy_alert','national_news') then 'news'
    when p_kind in ('meeting','meeting_reminder','meeting_upcoming','meeting_live','bill_meeting_reminder','bop_hearing') then 'meetings'
    when p_kind in ('forum_new_thread','forum_reply','thread_reply','post_reply') then 'community'
    when p_kind in ('whats_new','gmail_connect_nudge','state_briefing_welcome') then 'announcements'
    -- campaigns keep their dedicated notify_*_campaigns gating in
    -- notify_users_for_campaign. Security/personal kinds (new_device,
    -- role_granted_*, intel_tip_approved/rejected, wave_fired) and
    -- admin/owner ops alerts (bop_*, state_flip) are never gated.
    else 'other'
  end;
$$;

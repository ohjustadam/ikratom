-- 0194_notification_categories.sql — per-CATEGORY notification preferences
-- (PR-J) + the non-resident campaign scope-out + push_send_log telemetry.
--
-- Users can now opt out by category of WHAT they get notified about (bills,
-- local reps, news, meetings, community, intel, announcements) — enforced at
-- ONE chokepoint: a BEFORE INSERT trigger on notifications. That covers every
-- creator (SQL triggers/functions AND every service-role TS path) without
-- touching any of them. Security/personal kinds are never gated. The gate
-- FAILS OPEN: a bug in it must never block a notification insert.
--
-- Also: digest CHECK constraint (values were app-enforced only), and the
-- allow_non_residents campaign arm now respects a per-user toggle (the
-- 2026-06-09 finding: one national campaign buzzed every state-opted user).
--
-- Rollback: drop trigger notifications_category_gate on notifications;
--   drop function notifications_category_gate(); drop function
--   notification_category(text); alter table notification_preferences drop
--   column ... (the 8 new booleans); drop table push_send_log;
--   re-create notify_users_for_campaign from 0008.

-- 1. Category columns — flat booleans, default ON (opt-out model).
-- (No "intel" toggle: the only intel-ish kinds today are admin/owner ops
-- alerts — a user toggle that gates nothing would be a lie.)
alter table public.notification_preferences
  add column if not exists notify_bills boolean not null default true,
  add column if not exists notify_local_reps boolean not null default true,
  add column if not exists notify_news boolean not null default true,
  add column if not exists notify_meetings boolean not null default true,
  add column if not exists notify_community boolean not null default true,
  add column if not exists notify_announcements boolean not null default true,
  add column if not exists notify_nonresident_campaigns boolean not null default true;

-- digest was documented-but-unchecked since 0008 — normalize any stray
-- value first (a single bad row would otherwise abort the migration), then
-- pin the enum.
update public.notification_preferences
   set digest = 'instant'
 where digest not in ('instant','daily','weekly','off');
do $$ begin
  alter table public.notification_preferences
    add constraint np_digest_chk check (digest in ('instant','daily','weekly','off'));
exception when duplicate_object then null; end $$;

-- 2. kind → category map. Unknown kinds = 'other' (never gated) so new
-- notification types are delivered until explicitly categorized here.
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
    when p_kind in ('forum_new_thread','forum_reply','thread_reply','post_reply') then 'community'
    when p_kind in ('whats_new','gmail_connect_nudge','state_briefing_welcome') then 'announcements'
    -- campaigns keep their dedicated notify_*_campaigns gating in
    -- notify_users_for_campaign. Security/personal kinds (new_device,
    -- role_granted_*, intel_tip_approved/rejected, wave_fired) and
    -- admin/owner ops alerts (bop_*, state_flip) are never gated.
    else 'other'
  end;
$$;

-- 3. THE chokepoint: BEFORE INSERT gate. Returns NULL (skip row) when the
-- recipient muted the row's category. Fails OPEN on any error.
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

drop trigger if exists notifications_category_gate on public.notifications;
create trigger notifications_category_gate
  before insert on public.notifications
  for each row
  execute function public.notifications_category_gate();

-- 4. Non-resident campaign scope-out: same function as 0008 with ONE change —
-- the allow_non_residents arm now also requires notify_nonresident_campaigns.
create or replace function public.notify_users_for_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.campaigns%rowtype;
begin
  select * into c from public.campaigns where id = p_campaign_id;
  if not found or not c.active then return; end if;

  insert into public.notifications (user_id, kind, title, body, link)
  select
    p.id,
    'new_campaign',
    c.title,
    coalesce(c.blurb, 'A new campaign is active.'),
    '/campaigns/' || c.slug
  from public.profiles p
  join public.notification_preferences np on np.user_id = p.id
  where
    np.in_app = true
    and np.digest <> 'off'
    and (
      (c.state is null and np.notify_federal_campaigns)
      or (c.state is not null and c.target_locality is null
          and np.notify_state_campaigns
          and p.state = c.state)
      or (c.target_locality is not null
          and np.notify_local_campaigns
          and (
               (p.city is not null and (p.city || ', ' || p.state) = c.target_locality)
            or (p.county is not null and (p.county || ', ' || p.state) = c.target_locality)
          ))
      -- Non-resident/national campaigns are now individually opt-out-able
      -- (2026-06-09: one broad campaign batch = 23 notifications/user).
      or (c.allow_non_residents = true
          and np.notify_state_campaigns
          and np.notify_nonresident_campaigns)
    )
  on conflict do nothing;
end;
$$;

-- 5. push_send_log — per-user per-run delivery telemetry. The #1 reason
-- "some users don't get notifications" was undiagnosable; this makes every
-- fan-out decision visible to /admin/notifications-health.
create table if not exists public.push_send_log (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null check (outcome in ('sent','held_dnd','held_rate','held_digest','opt_out','no_subs','error')),
  notification_count int not null default 0,
  subscription_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists push_send_log_run_idx on public.push_send_log (run_at desc);
create index if not exists push_send_log_user_idx on public.push_send_log (user_id, run_at desc);

alter table public.push_send_log enable row level security;

create policy "Admins read push send log"
  on public.push_send_log for select
  using (public.is_admin(auth.uid()));
-- writes: service role only (no user policies)

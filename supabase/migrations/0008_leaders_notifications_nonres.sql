-- ============================================================
-- 0008 — Advocate-leader role, non-resident campaigns, notifications
-- ============================================================

-- 1. Advocate-leader role on profiles
alter table public.profiles
  add column if not exists is_advocate_leader boolean not null default false;

-- 2. Helper SQL function: is the user a campaign creator (admin OR leader)?
create or replace function public.is_campaign_creator(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or is_owner or is_advocate_leader
       from public.profiles where id = uid),
    false
  );
$$;

grant execute on function public.is_campaign_creator(uuid) to anon, authenticated;

-- 3. Open RLS for campaigns + legislators (locals only) to advocate-leaders
--    Admins still get full access via existing is_admin policies.

drop policy if exists "campaigns_creator_write" on public.campaigns;
create policy "campaigns_creator_write" on public.campaigns
  for all
  using (public.is_campaign_creator(auth.uid()))
  with check (public.is_campaign_creator(auth.uid()));

-- Legislators: leaders can write ONLY local rows (level in municipal/county).
-- This protects state/federal sync data from being hand-edited.
drop policy if exists "legislators_creator_local_write" on public.legislators;
create policy "legislators_creator_local_write" on public.legislators
  for all
  using (
    public.is_campaign_creator(auth.uid())
    and level in ('municipal', 'county')
  )
  with check (
    public.is_campaign_creator(auth.uid())
    and level in ('municipal', 'county')
  );

-- ============================================================
-- 4. Non-resident campaigns
-- ============================================================
alter table public.campaigns
  add column if not exists allow_non_residents boolean not null default false;

-- Track whether a given action came from a constituent or a non-resident
alter table public.campaign_actions
  add column if not exists is_non_resident boolean not null default false;

-- ============================================================
-- 5. Notifications + preferences
-- ============================================================

-- Per-user preferences. Inserted automatically on user signup (trigger update below).
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- which campaign scopes does the user want to be notified about?
  notify_state_campaigns boolean not null default true,
  notify_local_campaigns boolean not null default true,
  notify_federal_campaigns boolean not null default true,
  -- delivery channels (email/push are scaffolded — actual delivery comes later)
  in_app boolean not null default true,
  email boolean not null default false,
  -- digest cadence
  digest text not null default 'instant',  -- 'instant' | 'daily' | 'weekly' | 'off'
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists "notif_prefs_self_rw" on public.notification_preferences;
create policy "notif_prefs_self_rw" on public.notification_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Notifications inbox. Each user gets a row per relevant event.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                         -- 'new_campaign' | 'bill_status' | 'meeting' | ...
  title text not null,
  body text,
  link text,                                  -- e.g. '/campaigns/ok-introduce-yourself'
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_self_read" on public.notifications;
create policy "notifications_self_read" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_self_update" on public.notifications;
create policy "notifications_self_update" on public.notifications
  for update using (auth.uid() = user_id);

drop policy if exists "notifications_self_delete" on public.notifications;
create policy "notifications_self_delete" on public.notifications
  for delete using (auth.uid() = user_id);

-- We don't allow user-side INSERT — server actions / triggers do the inserting
-- (using the SECURITY DEFINER notify_users function below, or via service role).

-- ============================================================
-- 6. Update the auto-create-profile trigger to also create default prefs
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill: any existing user without prefs
insert into public.notification_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ============================================================
-- 7. notify_users_for_campaign(campaign_id)
--    Server-side fan-out: looks at campaign scope + user prefs/locations
--    and inserts notifications for matching users.
--    Called from a Postgres trigger on campaign INSERT/UPDATE.
-- ============================================================
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
      -- Federal campaigns
      (c.state is null and np.notify_federal_campaigns)
      -- State campaigns matching user's state
      or (c.state is not null and c.target_locality is null
          and np.notify_state_campaigns
          and p.state = c.state)
      -- Local campaigns matching user's city or county locality
      or (c.target_locality is not null
          and np.notify_local_campaigns
          and (
               (p.city is not null and (p.city || ', ' || p.state) = c.target_locality)
            or (p.county is not null and (p.county || ', ' || p.state) = c.target_locality)
          ))
      -- Non-resident campaigns notify everyone who opted into any of the campaigns relevant to their config
      or (c.allow_non_residents = true and np.notify_state_campaigns)
    )
  on conflict do nothing;
end;
$$;

grant execute on function public.notify_users_for_campaign(uuid) to authenticated;

-- Trigger on campaign create/update — fan-out is automatic
create or replace function public.trg_campaign_notify()
returns trigger
language plpgsql
as $$
begin
  if new.active and (tg_op = 'INSERT' or old.active = false) then
    perform public.notify_users_for_campaign(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists campaign_notify_trigger on public.campaigns;
create trigger campaign_notify_trigger
  after insert or update on public.campaigns
  for each row
  execute function public.trg_campaign_notify();

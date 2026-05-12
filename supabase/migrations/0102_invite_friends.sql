-- ============================================================
-- 0102_invite_friends
--
-- Solid invite-friends feature: per-user invite code, attribution at
-- signup, funnel tracking (joined → first action).
--
-- Tables / columns:
--   profiles.invite_code         — short, URL-safe, unique. Auto-set
--                                  for every existing + future row.
--   profiles.referrer_id         — already existed (migration 0075);
--                                  this PR wires it via cookie capture
--                                  on signup.
--   invite_redemptions           — one row per (inviter, invitee) link.
--                                  Tracks landing + signup + first
--                                  action timestamps so the inviter's
--                                  hub can show conversion funnel.
-- ============================================================

-- 1. Add invite_code to profiles.
alter table public.profiles
  add column if not exists invite_code text;

-- Backfill any existing rows with a random 10-char base36 code.
-- We loop until everyone has one — safe to re-run (where is null).
do $$
declare
  v_id uuid;
  v_code text;
begin
  for v_id in select id from public.profiles where invite_code is null
  loop
    -- Generate 8-char alnum-lowercase. Collision-probability is
    -- ~1 in 36^8 = ~2.8e12. Loop on conflict just in case.
    loop
      v_code := substring(
        translate(encode(gen_random_bytes(6), 'base64'),
                  '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                  '00abcdefghijklmnopqrstuvwxyz'),
        1, 8);
      begin
        update public.profiles set invite_code = v_code where id = v_id;
        exit;
      exception when unique_violation then
        -- vanishingly rare; retry
        continue;
      end;
    end loop;
  end loop;
end$$;

create unique index if not exists ix_profiles_invite_code
  on public.profiles (invite_code)
  where invite_code is not null;

-- Going forward: trigger-fill invite_code on insert so new profiles
-- always have one.
create or replace function public.set_profile_invite_code()
returns trigger
language plpgsql
as $$
declare
  v_code text;
  v_attempts int := 0;
begin
  if new.invite_code is not null then return new; end if;
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 5 then
      raise exception 'could not generate unique invite_code after 5 attempts';
    end if;
    v_code := substring(
      translate(encode(gen_random_bytes(6), 'base64'),
                '+/=ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                '00abcdefghijklmnopqrstuvwxyz'),
      1, 8);
    if not exists (select 1 from public.profiles where invite_code = v_code) then
      new.invite_code := v_code;
      exit;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_profiles_invite_code on public.profiles;
create trigger trg_profiles_invite_code
  before insert on public.profiles
  for each row execute function public.set_profile_invite_code();

-- 2. Redemptions table — joined-via-invite funnel.
create table if not exists public.invite_redemptions (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id) on delete cascade,
  invitee_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null,                 -- denorm for audit even if inviter rotates codes someday
  landed_at timestamptz not null default now(),
  signed_up_at timestamptz,                  -- set when invitee_id row gets created (i.e. they completed signup)
  first_action_at timestamptz,               -- set when invitee first sends a campaign action
  created_at timestamptz not null default now(),
  unique (inviter_id, invitee_id)            -- one redemption per pair
);

create index if not exists ix_invite_redemptions_inviter
  on public.invite_redemptions (inviter_id, signed_up_at desc nulls last);
create index if not exists ix_invite_redemptions_invitee
  on public.invite_redemptions (invitee_id);

alter table public.invite_redemptions enable row level security;

-- Inviter can see their own redemptions. Admin sees all.
drop policy if exists invite_redemptions_self_read on public.invite_redemptions;
create policy invite_redemptions_self_read on public.invite_redemptions
  for select to authenticated
  using (
    inviter_id = auth.uid()
    or public.is_admin(auth.uid())
  );

-- No insert policy — writes go through SECURITY DEFINER RPC below
-- so the inviter_id can be derived from the cookie-captured code
-- without trusting a client value.

-- 3. RPC the signup flow calls to link a fresh invitee to their inviter.
-- Idempotent: re-calls for the same pair don't duplicate.
create or replace function public.record_invite_redemption(
  p_invitee uuid,
  p_invite_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inviter uuid;
  v_rid uuid;
begin
  if p_invitee is null or p_invite_code is null then return null; end if;
  if length(p_invite_code) < 4 or length(p_invite_code) > 32 then return null; end if;

  -- Find the inviter from the code. Lowercase comparison — codes are
  -- stored lowercase but URL params may arrive cased.
  select id into v_inviter
    from public.profiles
   where invite_code = lower(p_invite_code)
   limit 1;
  if v_inviter is null then return null; end if;
  if v_inviter = p_invitee then return null; -- self-invite ignored

  end if;

  -- Insert or fetch existing redemption row.
  insert into public.invite_redemptions (inviter_id, invitee_id, invite_code, signed_up_at)
  values (v_inviter, p_invitee, lower(p_invite_code), now())
  on conflict (inviter_id, invitee_id) do update
    set signed_up_at = coalesce(invite_redemptions.signed_up_at, excluded.signed_up_at)
  returning id into v_rid;

  -- Mirror onto profiles.referrer_id (single source of truth for "who
  -- brought this user in") — only if not already set by some other path.
  update public.profiles
     set referrer_id = v_inviter
   where id = p_invitee
     and referrer_id is null;

  return v_rid;
end;
$$;

grant execute on function public.record_invite_redemption(uuid, text) to authenticated, anon;

-- 4. Trigger to mark first_action_at on the inviter's redemption row
-- when an invitee sends their first campaign action. Best-effort: if
-- the row already has first_action_at, we don't overwrite.
create or replace function public.bump_inviter_first_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invite_redemptions
     set first_action_at = coalesce(first_action_at, now())
   where invitee_id = new.user_id
     and first_action_at is null;
  return new;
end;
$$;

drop trigger if exists trg_invite_first_action on public.campaign_actions;
create trigger trg_invite_first_action
  after insert on public.campaign_actions
  for each row execute function public.bump_inviter_first_action();

-- 5. Public-safe RPC for the inviter's hub: returns funnel counts.
create or replace function public.get_my_invite_summary()
returns table (
  invite_code text,
  total_signups int,
  total_with_first_action int
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.invite_code,
    coalesce((select count(*) from public.invite_redemptions r
              where r.inviter_id = auth.uid() and r.signed_up_at is not null), 0)::int as total_signups,
    coalesce((select count(*) from public.invite_redemptions r
              where r.inviter_id = auth.uid() and r.first_action_at is not null), 0)::int as total_with_first_action
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

grant execute on function public.get_my_invite_summary() to authenticated;

comment on column public.profiles.invite_code is
  'Per-user short code embedded in invite URLs (?ref=CODE). Backfilled by migration 0102. Auto-set on insert via trigger.';
comment on table public.invite_redemptions is
  'One row per (inviter, invitee) link. Tracks landing → signed_up → first_action funnel. Inviter row in profiles.referrer_id mirrors inviter_id.';

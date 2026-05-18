-- ============================================================
-- 0153_coalitions
--
-- Coalition Layer: multi-advocate teams with invite codes + shared
-- visibility. The first network-effect feature on the platform —
-- individual advocates compose into named groups that organize around
-- a state, a bill, or a campaign theme.
--
-- Three tables:
--   1. coalitions          — the group itself (name, slug, owner, state, public)
--   2. coalition_members   — who's in it + their role (owner/admin/member)
--   3. coalition_invites   — short-code single-use (or N-use) invites
--
-- Privacy/safety posture:
--   - Coalitions DEFAULT to private (is_public = false). Members
--     don't appear in any cross-coalition list. The platform's
--     adversaries are well-resourced; doxing risk is real.
--   - Public coalitions opt in. Even then, only the coalition name +
--     description + owner display name appear in /coalitions index;
--     member list visible only to members.
--   - Invite codes are short (10 chars, URL-safe) but rate-limited at
--     the action layer (not in SQL). Single-use by default; admins
--     can extend max_uses for organizer-style links.
--
-- RLS strategy:
--   - coalitions: public coalitions visible to anyone; private only
--     to members + owner. Owner can update; only owner can delete.
--   - coalition_members: members of a coalition see the member list;
--     non-members see nothing. Owner can add/remove anyone; members
--     can remove themselves (leave). Owner row protected from delete.
--   - coalition_invites: only coalition owner/admin can create or
--     view invites. SELECT-by-code is service-role-only (looked up
--     via a SECURITY DEFINER RPC on join). This prevents enumeration
--     attacks where an attacker probes codes via REST.
--
-- Rollback:
--   DROP TABLE IF EXISTS coalition_invites;
--   DROP TABLE IF EXISTS coalition_members;
--   DROP TABLE IF EXISTS coalitions;

create extension if not exists "pgcrypto";

-- =============================================================
-- 1. coalitions
-- =============================================================
create table if not exists public.coalitions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null check (char_length(name) between 2 and 80),
  description  text check (description is null or char_length(description) <= 2000),
  -- Optional scope: state abbr, or NULL for national/multi-state.
  state        text references public.states(abbr),
  owner_id     uuid not null references public.profiles(id) on delete restrict,
  -- Privacy default: false. Listing on /coalitions opt-in.
  is_public    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists coalitions_state_idx     on public.coalitions (state);
create index if not exists coalitions_owner_idx     on public.coalitions (owner_id);
create index if not exists coalitions_is_public_idx on public.coalitions (is_public) where is_public = true;

-- Slug invariants enforced at app layer (lowercase hyphenated). We
-- only enforce uniqueness + reasonable length here.
alter table public.coalitions
  drop constraint if exists coalitions_slug_format_chk;
alter table public.coalitions
  add constraint coalitions_slug_format_chk
  check (slug ~* '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$');

-- updated_at trigger
create or replace function public.coalitions_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists coalitions_touch_updated_at on public.coalitions;
create trigger coalitions_touch_updated_at
  before update on public.coalitions
  for each row execute function public.coalitions_touch_updated_at();

-- =============================================================
-- 2. coalition_members
-- =============================================================
create table if not exists public.coalition_members (
  coalition_id uuid not null references public.coalitions(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- 'owner' | 'admin' | 'member'. Owner role is set on creation and
  -- exactly one row per coalition has role='owner' (enforced at app
  -- layer; the FK on owner_id is the source of truth).
  role         text not null default 'member'
                 check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default now(),
  primary key (coalition_id, user_id)
);

create index if not exists coalition_members_user_idx on public.coalition_members (user_id);

-- =============================================================
-- 3. coalition_invites
-- =============================================================
create table if not exists public.coalition_invites (
  id            uuid primary key default gen_random_uuid(),
  coalition_id  uuid not null references public.coalitions(id) on delete cascade,
  code          text not null unique check (code ~ '^[A-Za-z0-9_-]{8,32}$'),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  -- Multi-use mode: set max_uses > 1 for a public organizer link.
  -- Default single-use protects against link-sharing leaks.
  max_uses      integer not null default 1 check (max_uses between 1 and 100),
  use_count     integer not null default 0 check (use_count >= 0)
);

create index if not exists coalition_invites_coalition_idx on public.coalition_invites (coalition_id);

-- =============================================================
-- RLS
-- =============================================================
alter table public.coalitions          enable row level security;
alter table public.coalition_members   enable row level security;
alter table public.coalition_invites   enable row level security;

-- Helper: is the requesting user a member of this coalition?
create or replace function public.is_coalition_member(p_coalition_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.coalition_members
    where coalition_id = p_coalition_id
      and user_id      = auth.uid()
  );
$$;

-- Helper: is the requesting user an owner/admin of this coalition?
create or replace function public.is_coalition_admin(p_coalition_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.coalition_members
    where coalition_id = p_coalition_id
      and user_id      = auth.uid()
      and role         in ('owner', 'admin')
  );
$$;

-- ── coalitions policies
drop policy if exists "coalitions: public read"      on public.coalitions;
drop policy if exists "coalitions: members read"     on public.coalitions;
drop policy if exists "coalitions: owner insert"    on public.coalitions;
drop policy if exists "coalitions: owner update"    on public.coalitions;
drop policy if exists "coalitions: owner delete"    on public.coalitions;

create policy "coalitions: public read"
  on public.coalitions for select
  using (is_public = true);

create policy "coalitions: members read"
  on public.coalitions for select
  using (
    auth.uid() is not null
    and (owner_id = auth.uid() or public.is_coalition_member(id))
  );

create policy "coalitions: owner insert"
  on public.coalitions for insert
  with check (auth.uid() is not null and owner_id = auth.uid());

create policy "coalitions: owner update"
  on public.coalitions for update
  using (auth.uid() is not null and owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "coalitions: owner delete"
  on public.coalitions for delete
  using (auth.uid() is not null and owner_id = auth.uid());

-- ── coalition_members policies
drop policy if exists "members: members read"  on public.coalition_members;
drop policy if exists "members: self insert"   on public.coalition_members;
drop policy if exists "members: admin insert"  on public.coalition_members;
drop policy if exists "members: self delete"   on public.coalition_members;
drop policy if exists "members: admin delete"  on public.coalition_members;

create policy "members: members read"
  on public.coalition_members for select
  using (
    auth.uid() is not null
    and public.is_coalition_member(coalition_id)
  );

-- INSERT happens via the join RPC (security definer) — direct INSERT
-- is restricted to the coalition admin (so admin can add users
-- explicitly). The RPC also handles self-join via invite code.
create policy "members: admin insert"
  on public.coalition_members for insert
  with check (
    auth.uid() is not null
    and public.is_coalition_admin(coalition_id)
  );

-- A user can leave any coalition they're in (delete their own row)
-- — EXCEPT if they're the owner. Owner deletion happens by deleting
-- the coalition itself or transferring ownership (v2).
create policy "members: self delete"
  on public.coalition_members for delete
  using (
    auth.uid() is not null
    and user_id = auth.uid()
    and role != 'owner'
  );

-- Admin can remove non-owners.
create policy "members: admin delete"
  on public.coalition_members for delete
  using (
    auth.uid() is not null
    and public.is_coalition_admin(coalition_id)
    and role != 'owner'
  );

-- ── coalition_invites policies
drop policy if exists "invites: admin read"   on public.coalition_invites;
drop policy if exists "invites: admin insert" on public.coalition_invites;
drop policy if exists "invites: admin delete" on public.coalition_invites;

-- Direct SELECT is admin-only — code lookup by joiners goes through
-- the security-definer RPC `join_coalition_via_code` (defined below).
create policy "invites: admin read"
  on public.coalition_invites for select
  using (
    auth.uid() is not null
    and public.is_coalition_admin(coalition_id)
  );

create policy "invites: admin insert"
  on public.coalition_invites for insert
  with check (
    auth.uid() is not null
    and public.is_coalition_admin(coalition_id)
    and created_by = auth.uid()
  );

create policy "invites: admin delete"
  on public.coalition_invites for delete
  using (
    auth.uid() is not null
    and public.is_coalition_admin(coalition_id)
  );

-- =============================================================
-- RPC: join_coalition_via_code
-- Atomic: validate code → insert member → bump use_count.
-- Returns coalition slug for redirect, or raises on invalid.
-- =============================================================
create or replace function public.join_coalition_via_code(p_code text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_coalition_id uuid;
  v_slug text;
  v_expires_at timestamptz;
  v_max_uses int;
  v_use_count int;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  -- Fetch the invite (this bypasses RLS because of security definer).
  select id, coalition_id, expires_at, max_uses, use_count
    into v_invite_id, v_coalition_id, v_expires_at, v_max_uses, v_use_count
    from public.coalition_invites
    where code = p_code;

  if v_invite_id is null then
    raise exception 'invite not found';
  end if;
  if v_expires_at is not null and v_expires_at < now() then
    raise exception 'invite expired';
  end if;
  if v_use_count >= v_max_uses then
    raise exception 'invite exhausted';
  end if;

  -- Check if user is already a member (idempotent join)
  if exists (
    select 1 from public.coalition_members
      where coalition_id = v_coalition_id
        and user_id      = v_user_id
  ) then
    select slug into v_slug from public.coalitions where id = v_coalition_id;
    return v_slug;
  end if;

  -- Insert membership
  insert into public.coalition_members (coalition_id, user_id, role)
    values (v_coalition_id, v_user_id, 'member');

  -- Bump use count
  update public.coalition_invites
    set use_count = use_count + 1
    where id = v_invite_id;

  select slug into v_slug from public.coalitions where id = v_coalition_id;
  return v_slug;
end;
$$;

grant execute on function public.join_coalition_via_code(text) to authenticated;

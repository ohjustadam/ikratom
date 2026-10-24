-- ============================================================
-- 0283 — Social profiles: per-section audiences + the one privacy rule
-- ============================================================
-- Owner ask 2026-10-24 (B4b, private/plans/SOCIAL_PLAYBOOK.md): a familiar,
-- Facebook-like profile that members can customize, with per-item privacy
-- Only me / Friends / Members / Public. Some members live in states where
-- kratom is banned, so privacy is enforced HERE, in the database, not in the UI.
--
-- 1. member_connections — the friend graph (mutual request/accept). Table only
--    in this migration (the privacy rule needs it); the write RPCs ship with the
--    connections slice (0285). Writes are RPC-only, so no INSERT/UPDATE grant.
-- 2. profile_social — bio, profile story, interests, and one audience per
--    section. Own-row RLS; other members read it ONLY through get_profile_view.
-- 3. profile_links — up to 5 https links. Own-row RLS.
-- 4. can_view_audience(owner, audience) — the ONE rule every read uses (RLS
--    policies and SECURITY DEFINER RPCs). The viewer is always auth.uid(); there
--    is deliberately NO viewer parameter, or anyone could probe whether two other
--    members are friends. A block in either direction hides everything.
-- 5. get_profile_view / get_profile_view_by_username — the profile page's one
--    read. Sections come back NULL when the viewer may not see them. Never
--    returns full_name, email, city, account age, public_key or the private
--    kratom_story / lose_if_banned.
-- 6. get_my_profile_social — the caller's own settings, with the safe defaults
--    applied when no row exists yet.
--
-- Defaults never widen anyone: with no profile_social row, the profile page
-- audience derives from the legacy profile_visibility (public → members,
-- recruiters_only → friends, private → only_me). profile_visibility itself is
-- untouched and still drives get_public_profiles + DM search (discoverability).
--
-- Tables created before 2026-10-30 still receive Supabase's default grants, so
-- each table REVOKEs them first and grants exactly what it needs.
--
-- Rollback:
--   drop function if exists public.get_profile_view_by_username(text);
--   drop function if exists public.get_profile_view(uuid);
--   drop function if exists public.get_my_profile_social();
--   drop function if exists public.can_view_audience(uuid, text);
--   drop function if exists public.default_profile_audience(text);
--   drop table if exists public.profile_links;
--   drop table if exists public.profile_social;
--   drop table if exists public.member_connections;

-- ---- 1. member_connections ----------------------------------------------
create table if not exists public.member_connections (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  constraint member_connections_not_self check (requester_id <> addressee_id),
  constraint member_connections_status_chk check (status in ('pending', 'accepted'))
);

-- One row per PAIR, whichever direction asked first.
create unique index if not exists ux_member_connections_pair
  on public.member_connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists ix_member_connections_addressee
  on public.member_connections (addressee_id, status);

alter table public.member_connections enable row level security;

drop policy if exists member_connections_party_read on public.member_connections;
create policy member_connections_party_read on public.member_connections
  for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

revoke all on public.member_connections from anon, authenticated;
grant select on public.member_connections to authenticated;
grant all on public.member_connections to service_role;

-- ---- 2. profile_social ----------------------------------------------------
create table if not exists public.profile_social (
  user_id                 uuid primary key references public.profiles(id) on delete cascade,
  bio                     text,
  story                   text,
  interests               text[] not null default '{}',
  profile_audience        text not null default 'members',
  bio_audience            text not null default 'members',
  story_audience          text not null default 'members',
  links_audience          text not null default 'members',
  interests_audience      text not null default 'members',
  photos_default_audience text not null default 'friends',
  friends_audience        text not null default 'friends',
  activity_audience       text not null default 'members',
  updated_at              timestamptz not null default now(),
  constraint profile_social_bio_len check (bio is null or char_length(bio) <= 300),
  constraint profile_social_story_len check (story is null or char_length(story) <= 2000),
  constraint profile_social_interests_cap check (cardinality(interests) <= 8),
  constraint profile_social_audiences_chk check (
        profile_audience        in ('only_me', 'friends', 'members', 'public')
    and bio_audience            in ('only_me', 'friends', 'members', 'public')
    and story_audience          in ('only_me', 'friends', 'members', 'public')
    and links_audience          in ('only_me', 'friends', 'members', 'public')
    and interests_audience      in ('only_me', 'friends', 'members', 'public')
    and photos_default_audience in ('only_me', 'friends', 'members', 'public')
    and friends_audience        in ('only_me', 'friends', 'members', 'public')
    and activity_audience       in ('only_me', 'friends', 'members', 'public')
  )
);

alter table public.profile_social enable row level security;

drop policy if exists profile_social_self_all on public.profile_social;
create policy profile_social_self_all on public.profile_social
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.profile_social from anon, authenticated;
grant select, insert, update, delete on public.profile_social to authenticated;
grant all on public.profile_social to service_role;

-- ---- 3. profile_links -----------------------------------------------------
create table if not exists public.profile_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  position   smallint not null,
  label      text not null,
  url        text not null,
  created_at timestamptz not null default now(),
  constraint profile_links_position_chk check (position between 0 and 4),
  constraint profile_links_label_len check (char_length(label) between 1 and 40),
  constraint profile_links_url_chk check (char_length(url) <= 300 and url ~ '^https://[^\s]+$'),
  constraint profile_links_user_position_key unique (user_id, position)
);

alter table public.profile_links enable row level security;

drop policy if exists profile_links_self_all on public.profile_links;
create policy profile_links_self_all on public.profile_links
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.profile_links from anon, authenticated;
grant select, insert, update, delete on public.profile_links to authenticated;
grant all on public.profile_links to service_role;

-- ---- 4. The privacy rule --------------------------------------------------
create or replace function public.default_profile_audience(p_visibility text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_visibility
    when 'public' then 'members'
    when 'recruiters_only' then 'friends'
    else 'only_me'
  end;
$$;

create or replace function public.can_view_audience(p_owner uuid, p_audience text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null then false
    when auth.uid() is not null and auth.uid() = p_owner then true
    when auth.uid() is not null and exists (
      select 1 from public.user_blocks b
       where (b.blocker_id = p_owner and b.blocked_id = auth.uid())
          or (b.blocker_id = auth.uid() and b.blocked_id = p_owner)
    ) then false
    when p_audience = 'public' then true
    when p_audience = 'members' then auth.uid() is not null
    when p_audience = 'friends' then auth.uid() is not null and exists (
      select 1 from public.member_connections c
       where c.status = 'accepted'
         and ((c.requester_id = p_owner and c.addressee_id = auth.uid())
           or (c.requester_id = auth.uid() and c.addressee_id = p_owner))
    )
    else false
  end;
$$;

revoke all on function public.default_profile_audience(text) from public;
revoke all on function public.can_view_audience(uuid, text) from public;
grant execute on function public.default_profile_audience(text) to anon, authenticated, service_role;
grant execute on function public.can_view_audience(uuid, text) to anon, authenticated, service_role;

comment on function public.can_view_audience is
  'THE privacy rule (0283): may auth.uid() see an item owned by p_owner at audience only_me|friends|members|public? Owner always; a block either way never. No viewer parameter by design (no friend-graph probing).';

-- ---- 5. The caller's own settings (defaults applied) ----------------------
create or replace function public.get_my_profile_social()
returns table (
  bio text,
  story text,
  interests text[],
  profile_audience text,
  bio_audience text,
  story_audience text,
  links_audience text,
  interests_audience text,
  photos_default_audience text,
  friends_audience text,
  activity_audience text,
  profile_visibility text
)
language sql
stable
security definer
set search_path = public
as $$
  select ps.bio,
         ps.story,
         coalesce(ps.interests, '{}'),
         coalesce(ps.profile_audience, public.default_profile_audience(p.profile_visibility)),
         coalesce(ps.bio_audience, 'members'),
         coalesce(ps.story_audience, 'members'),
         coalesce(ps.links_audience, 'members'),
         coalesce(ps.interests_audience, 'members'),
         coalesce(ps.photos_default_audience, 'friends'),
         coalesce(ps.friends_audience, 'friends'),
         coalesce(ps.activity_audience, 'members'),
         p.profile_visibility
    from public.profiles p
    left join public.profile_social ps on ps.user_id = p.id
   where p.id = auth.uid();
$$;

revoke all on function public.get_my_profile_social() from public, anon;
grant execute on function public.get_my_profile_social() to authenticated;

-- ---- 6. The profile page's one read ---------------------------------------
-- relationship: self | blocked (the VIEWER blocked them; the row exists so they
-- can unblock) | friends | pending_out | pending_in | none.
-- No row at all when: the owner blocked the viewer, or the viewer may not see
-- the profile AND the owner is not discoverable (profile_visibility <> public),
-- so neither an id nor a username can be used to confirm a hidden member exists.
create or replace function public.get_profile_view(p_id uuid)
returns table (
  id uuid,
  username text,
  state text,
  is_admin boolean,
  is_advocate_leader boolean,
  relationship text,
  profile_visible boolean,
  profile_audience text,
  can_message boolean,
  bio text,
  story text,
  interests text[],
  links jsonb,
  friend_count integer,
  activity_visible boolean,
  thread_count integer,
  action_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  p record;
  ps public.profile_social;
  v_rel text := 'none';
  v_aud text;
  v_visible boolean;
begin
  select pr.id, pr.username, pr.state, pr.is_admin, pr.is_advocate_leader,
         pr.profile_visibility, pr.public_key
    into p
    from public.profiles pr
   where pr.id = p_id;
  if not found then
    return;
  end if;

  select s.* into ps from public.profile_social s where s.user_id = p_id;

  if v_viewer is not null then
    if v_viewer = p_id then
      v_rel := 'self';
    elsif exists (select 1 from public.user_blocks b where b.blocker_id = p_id and b.blocked_id = v_viewer) then
      return; -- they blocked you: you cannot tell they exist
    elsif exists (select 1 from public.user_blocks b where b.blocker_id = v_viewer and b.blocked_id = p_id) then
      v_rel := 'blocked';
    else
      select case
               when c.status = 'accepted' then 'friends'
               when c.requester_id = v_viewer then 'pending_out'
               else 'pending_in'
             end
        into v_rel
        from public.member_connections c
       where (c.requester_id = v_viewer and c.addressee_id = p_id)
          or (c.requester_id = p_id and c.addressee_id = v_viewer)
       limit 1;
      v_rel := coalesce(v_rel, 'none');
    end if;
  end if;

  v_aud := coalesce(ps.profile_audience, public.default_profile_audience(p.profile_visibility));
  v_visible := v_rel <> 'blocked' and public.can_view_audience(p_id, v_aud);

  if not v_visible and v_rel not in ('self', 'blocked') and p.profile_visibility <> 'public' then
    return;
  end if;

  id := p.id;
  username := p.username;
  is_admin := coalesce(p.is_admin, false);
  is_advocate_leader := coalesce(p.is_advocate_leader, false);
  relationship := v_rel;
  profile_visible := v_visible;
  profile_audience := case when v_visible then v_aud else null end;
  can_message := v_visible and v_viewer is not null and v_rel not in ('self', 'blocked')
                 and p.public_key is not null;

  if v_visible then
    state := p.state;
    -- Each section: the stricter of the profile audience and its own audience.
    bio := case when public.can_view_audience(p_id, coalesce(ps.bio_audience, 'members')) then ps.bio end;
    story := case when public.can_view_audience(p_id, coalesce(ps.story_audience, 'members')) then ps.story end;
    interests := case when public.can_view_audience(p_id, coalesce(ps.interests_audience, 'members'))
                      then coalesce(ps.interests, '{}') end;
    if public.can_view_audience(p_id, coalesce(ps.links_audience, 'members')) then
      select coalesce(jsonb_agg(jsonb_build_object('label', l.label, 'url', l.url) order by l.position), '[]'::jsonb)
        into links
        from public.profile_links l
       where l.user_id = p_id;
    end if;
    if public.can_view_audience(p_id, coalesce(ps.friends_audience, 'friends')) then
      select count(*)::int into friend_count
        from public.member_connections c
       where c.status = 'accepted' and (c.requester_id = p_id or c.addressee_id = p_id);
    end if;
    activity_visible := public.can_view_audience(p_id, coalesce(ps.activity_audience, 'members'));
    if activity_visible then
      -- Group threads (community_id set) are excluded: listing them would
      -- reveal which private groups the member belongs to.
      select count(*)::int into thread_count
        from public.forum_threads t
       where t.author_id = p_id and t.moderation_status = 'approved' and t.community_id is null;
      select count(*)::int into action_count
        from public.campaign_actions a
       where a.user_id = p_id;
    end if;
  end if;

  return next;
end;
$$;

-- /profile/@handle. Same gates as get_profile_view: a hidden member and a
-- non-existent handle look identical.
create or replace function public.get_profile_view_by_username(p_username text)
returns table (
  id uuid,
  username text,
  state text,
  is_admin boolean,
  is_advocate_leader boolean,
  relationship text,
  profile_visible boolean,
  profile_audience text,
  can_message boolean,
  bio text,
  story text,
  interests text[],
  links jsonb,
  friend_count integer,
  activity_visible boolean,
  thread_count integer,
  action_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_username is null or char_length(p_username) > 40 then
    return;
  end if;
  select pr.id into v_id
    from public.profiles pr
   where pr.username = lower(regexp_replace(p_username, '^@', ''));
  if v_id is null then
    return;
  end if;
  return query select * from public.get_profile_view(v_id);
end;
$$;

revoke all on function public.get_profile_view(uuid) from public;
revoke all on function public.get_profile_view_by_username(text) from public;
grant execute on function public.get_profile_view(uuid) to anon, authenticated, service_role;
grant execute on function public.get_profile_view_by_username(text) to anon, authenticated, service_role;

comment on function public.get_profile_view is
  'Profile page read (0283). Sections NULL unless can_view_audience allows; never full_name/email/city/account age/public_key/kratom_story. No row = blocked by owner, or hidden and not discoverable.';

-- ============================================================
-- 0286 — Member photos: avatar, cover, album, each with its own audience
-- ============================================================
-- B4b slice (b), private/plans/SOCIAL_PLAYBOOK.md §3-4. Bytes live in a PRIVATE
-- Cloudflare R2 bucket (never Supabase Storage: egress). This migration holds
-- only the index of photos and the rules for who may see each one.
--
-- 1. member_photos — one row per stored image. INSERT is service-role only:
--    the upload route writes the row after it has stripped the metadata and
--    stored the bytes, so a member can never point a row at someone else's
--    object. Members may UPDATE only (audience, caption) and DELETE their own.
--    SELECT RLS = the owner, or an active photo can_view_audience() allows.
-- 2. member_photo_reports — a report button for every photo you can see.
--    Inserted only through report_member_photo(); 3 distinct reporters hide
--    the photo pending admin review. Admins read reports; members never do.
-- 3. profile_social.avatar_photo_id / cover_photo_id. Members lose the column
--    privilege to write them (only the upload route sets them), so nobody can
--    adopt another member's photo as their own avatar.
-- 4. get_media_object — what the /api/media/<id> route needs to presign a
--    read, returned ONLY when the viewer may see the photo (admins: always).
--    get_profile_photos — a member's photos as the viewer may see them.
-- 5. get_public_profile(s) keep their exact columns, but avatar_url is now the
--    member's avatar route, and only when the viewer may see that avatar.
--    get_profile_view gains avatar_url + cover_url under the same rule.
-- 6. guard_profiles_self_privilege: a member may self-set profiles.avatar_url
--    only to null or to their own media route. Before this, anyone could PATCH
--    an external URL and log the IP of every member who viewed their avatar.
--
-- Rollback:
--   restore 0234's guard body; re-apply 0187's get_public_profile(s) bodies;
--   re-apply 0285's get_profile_view(_by_username);
--   drop function public.get_media_object(uuid), public.get_profile_photos(uuid, integer),
--     public.report_member_photo(uuid, text, text);
--   alter table public.profile_social drop column avatar_photo_id, drop column cover_photo_id;
--   drop table public.member_photo_reports; drop table public.member_photos;

-- ---- 1. member_photos -----------------------------------------------------
create table if not exists public.member_photos (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,
  r2_key       text not null unique,
  content_type text not null,
  bytes        integer not null,
  width        integer not null,
  height       integer not null,
  caption      text,
  audience     text not null default 'friends',
  status       text not null default 'active',
  report_count integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint member_photos_kind_chk check (kind in ('avatar', 'cover', 'album')),
  constraint member_photos_type_chk check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint member_photos_audience_chk check (audience in ('only_me', 'friends', 'members', 'public')),
  constraint member_photos_status_chk check (status in ('active', 'hidden', 'removed')),
  constraint member_photos_caption_len check (caption is null or char_length(caption) <= 300),
  constraint member_photos_bytes_chk check (bytes between 1 and 5242880),
  constraint member_photos_dims_chk check (width between 1 and 8000 and height between 1 and 8000),
  constraint member_photos_key_chk check (r2_key = 'photos/' || owner_id::text || '/' || id::text || substring(r2_key from '\.[a-z]+$'))
);

create index if not exists ix_member_photos_owner on public.member_photos (owner_id, kind, created_at desc);
create index if not exists ix_member_photos_reported on public.member_photos (report_count desc) where report_count > 0;

alter table public.member_photos enable row level security;

drop policy if exists member_photos_read on public.member_photos;
create policy member_photos_read on public.member_photos
  for select to anon, authenticated
  using (owner_id = auth.uid() or (status = 'active' and public.can_view_audience(owner_id, audience)));

drop policy if exists member_photos_owner_update on public.member_photos;
create policy member_photos_owner_update on public.member_photos
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists member_photos_owner_delete on public.member_photos;
create policy member_photos_owner_delete on public.member_photos
  for delete to authenticated
  using (owner_id = auth.uid());

revoke all on public.member_photos from anon, authenticated;
-- No r2_key in the readable column set: the storage key is the route's business.
grant select (id, owner_id, kind, content_type, width, height, caption, audience, status, created_at)
  on public.member_photos to anon, authenticated;
grant update (audience, caption) on public.member_photos to authenticated;
grant delete on public.member_photos to authenticated;
grant all on public.member_photos to service_role;

-- ---- 2. member_photo_reports ----------------------------------------------
create table if not exists public.member_photo_reports (
  photo_id    uuid not null references public.member_photos(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (photo_id, reporter_id),
  constraint member_photo_reports_reason_chk check (reason in ('nudity', 'harassment', 'personal_info', 'spam', 'violence', 'other')),
  constraint member_photo_reports_note_len check (note is null or char_length(note) <= 300)
);

alter table public.member_photo_reports enable row level security;

drop policy if exists member_photo_reports_admin_read on public.member_photo_reports;
create policy member_photo_reports_admin_read on public.member_photo_reports
  for select to authenticated
  using (public.is_admin(auth.uid()));

revoke all on public.member_photo_reports from anon, authenticated;
grant select on public.member_photo_reports to authenticated;
grant all on public.member_photo_reports to service_role;

-- ---- 3. avatar + cover pointers -------------------------------------------
alter table public.profile_social
  add column if not exists avatar_photo_id uuid references public.member_photos(id) on delete set null,
  add column if not exists cover_photo_id  uuid references public.member_photos(id) on delete set null;

-- Members keep INSERT/UPDATE on every column EXCEPT the two pointers.
revoke insert, update on public.profile_social from authenticated;
grant insert (user_id, bio, story, interests, profile_audience, bio_audience, story_audience, links_audience,
              interests_audience, photos_default_audience, friends_audience, activity_audience, updated_at)
  on public.profile_social to authenticated;
-- user_id is in the UPDATE set because a PostgREST upsert re-sets the conflict
-- column; the own-row WITH CHECK still pins it to auth.uid().
grant update (user_id, bio, story, interests, profile_audience, bio_audience, story_audience, links_audience,
              interests_audience, photos_default_audience, friends_audience, activity_audience, updated_at)
  on public.profile_social to authenticated;

-- ---- 4. read RPCs ---------------------------------------------------------
create or replace function public.get_media_object(p_id uuid)
returns table (r2_key text, content_type text, audience text)
language sql
stable
security definer
set search_path = public
as $$
  select m.r2_key, m.content_type, m.audience
    from public.member_photos m
   where m.id = p_id
     and (m.owner_id = auth.uid()
          or public.is_admin(auth.uid())
          or (m.status = 'active' and public.can_view_audience(m.owner_id, m.audience)));
$$;

create or replace function public.get_profile_photos(p_owner uuid, p_limit integer default 60)
returns table (id uuid, kind text, caption text, width integer, height integer, audience text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.kind, m.caption, m.width, m.height,
         case when m.owner_id = auth.uid() then m.audience end,
         m.created_at
    from public.member_photos m
   where m.owner_id = p_owner
     and (m.owner_id = auth.uid() or (m.status = 'active' and public.can_view_audience(m.owner_id, m.audience)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 60), 120));
$$;

-- A member's avatar route, or null when the viewer may not see it.
create or replace function public.visible_avatar_url(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select '/api/media/' || m.id::text
    from public.profile_social ps
    join public.member_photos m on m.id = ps.avatar_photo_id
   where ps.user_id = p_owner
     and (m.owner_id = auth.uid() or (m.status = 'active' and public.can_view_audience(m.owner_id, m.audience)));
$$;

create or replace function public.visible_cover_url(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select '/api/media/' || m.id::text
    from public.profile_social ps
    join public.member_photos m on m.id = ps.cover_photo_id
   where ps.user_id = p_owner
     and (m.owner_id = auth.uid() or (m.status = 'active' and public.can_view_audience(m.owner_id, m.audience)));
$$;

-- ---- report ---------------------------------------------------------------
create or replace function public.report_member_photo(p_photo uuid, p_reason text, p_note text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'sign in to report';
  end if;
  select m.owner_id into v_owner
    from public.member_photos m
   where m.id = p_photo and m.status = 'active' and public.can_view_audience(m.owner_id, m.audience);
  if v_owner is null or v_owner = auth.uid() then
    return false; -- you can only report a photo you can see, and not your own
  end if;
  insert into public.member_photo_reports (photo_id, reporter_id, reason, note)
    values (p_photo, auth.uid(), p_reason, nullif(left(coalesce(p_note, ''), 300), ''))
    on conflict (photo_id, reporter_id) do nothing;
  select count(*)::int into v_count from public.member_photo_reports r where r.photo_id = p_photo;
  update public.member_photos
     set report_count = v_count,
         status = case when v_count >= 3 and status = 'active' then 'hidden' else status end
   where id = p_photo;
  return true;
end;
$$;

revoke all on function public.get_media_object(uuid) from public;
revoke all on function public.get_profile_photos(uuid, integer) from public;
revoke all on function public.visible_avatar_url(uuid) from public;
revoke all on function public.visible_cover_url(uuid) from public;
revoke all on function public.report_member_photo(uuid, text, text) from public, anon;
grant execute on function public.get_media_object(uuid) to anon, authenticated, service_role;
grant execute on function public.get_profile_photos(uuid, integer) to anon, authenticated, service_role;
grant execute on function public.visible_avatar_url(uuid) to anon, authenticated, service_role;
grant execute on function public.visible_cover_url(uuid) to anon, authenticated, service_role;
grant execute on function public.report_member_photo(uuid, text, text) to authenticated, service_role;

-- ---- 5. avatar-aware public profile RPCs (columns unchanged since 0187) ---
create or replace function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  username text,
  state text,
  avatar_url text,
  is_admin boolean,
  is_advocate_leader boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username, p.state, public.visible_avatar_url(p.id), p.is_admin, p.is_advocate_leader
    from public.profiles p
   where p.id = p_id
     and p.profile_visibility = 'public';
$$;

create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id uuid,
  username text,
  state text,
  avatar_url text,
  is_admin boolean,
  is_advocate_leader boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.username, p.state, public.visible_avatar_url(p.id), p.is_admin, p.is_advocate_leader
    from public.profiles p
   where p.id = any(p_ids)
     and p.profile_visibility = 'public';
$$;

-- get_profile_view gains avatar_url + cover_url: the OUT columns change, so
-- drop and recreate both readers (bodies otherwise identical to 0285).
drop function if exists public.get_profile_view_by_username(text);
drop function if exists public.get_profile_view(uuid);

create function public.get_profile_view(p_id uuid)
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
  avatar_url text,
  cover_url text,
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
      return;
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
  -- The avatar follows its OWN audience (like the @handle card it sits on);
  -- a blocked pair never sees it because can_view_audience says no.
  avatar_url := case when v_rel <> 'blocked' then public.visible_avatar_url(p_id) end;

  if v_visible then
    state := p.state;
    cover_url := public.visible_cover_url(p_id);
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

create function public.get_profile_view_by_username(p_username text)
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
  avatar_url text,
  cover_url text,
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

-- ---- 6. guard: profiles.avatar_url may only be null or your own route -----
create or replace function public.guard_profiles_self_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_owner boolean;
begin
  -- Service-role / no session → trusted (cron + server actions already checked).
  if auth.uid() is null then
    return new;
  end if;

  caller_is_owner := coalesce(
    (select p.is_owner from public.profiles p where p.id = auth.uid()),
    false
  );

  -- 1. is_owner is the master flag: only an owner may grant/revoke it, on ANY row.
  if (new.is_owner is distinct from old.is_owner) and not caller_is_owner then
    raise exception 'only an owner may change owner status';
  end if;

  -- 2. Privilege columns: a user may not change them on their OWN row (admins set
  --    is_admin/is_advocate_leader on OTHER users via the role-grant action).
  if auth.uid() = old.id
     and (new.is_admin           is distinct from old.is_admin
       or new.is_advocate_leader is distinct from old.is_advocate_leader
       or new.intel_tier         is distinct from old.intel_tier
       or new.intel_tier_locked  is distinct from old.intel_tier_locked)
     and not caller_is_owner
  then
    raise exception 'not authorized to modify privilege columns on your own profile';
  end if;

  -- 3. Moderation lock: a user may not lock/unlock their OWN account (self-unlock
  --    = ban evasion). Admins lock OTHER users cross-user, which is allowed.
  if auth.uid() = old.id
     and (new.account_locked_at     is distinct from old.account_locked_at
       or new.account_locked_reason is distinct from old.account_locked_reason)
     and not caller_is_owner
  then
    raise exception 'not authorized to change account lock state on your own profile';
  end if;

  -- 4. Vendor approval: a user may APPLY (self-set status='pending' + business
  --    fields, approver stamp null — applyForVendorStatus) but may NOT self-APPROVE.
  --    Block a self transition INTO 'approved' and any self-set of the approver stamp.
  if auth.uid() = old.id and not caller_is_owner then
    if new.vendor_status = 'approved' and old.vendor_status is distinct from 'approved' then
      raise exception 'vendor approval is admin-only';
    end if;
    if (new.vendor_approved_at is not null and new.vendor_approved_at is distinct from old.vendor_approved_at)
       or (new.vendor_approved_by is not null and new.vendor_approved_by is distinct from old.vendor_approved_by)
    then
      raise exception 'vendor approval fields are admin-only';
    end if;
  end if;

  -- 5. Avatar (0286): rendered as an <img> to other members, so an external URL
  --    would log every viewer's IP. A self-write may only clear it or point at
  --    one of the member's OWN photos through the privacy-checking media route.
  if auth.uid() = old.id
     and new.avatar_url is distinct from old.avatar_url
     and new.avatar_url is not null
     and not exists (
       select 1 from public.member_photos m
        where m.owner_id = old.id
          and new.avatar_url = '/api/media/' || m.id::text
     )
  then
    raise exception 'avatar_url may only point at one of your own photos';
  end if;

  return new;
end;
$$;

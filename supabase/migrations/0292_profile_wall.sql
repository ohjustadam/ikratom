-- ============================================================
-- 0292 — the profile wall (B4b slice e)
-- ============================================================
-- Posts on a member's profile, visible by audience, with comments.
--
--   Who sees the wall:  profile_social.wall_audience (Only me / Friends /
--                       Members / Public), NEVER wider than profile_audience.
--   Who may post:       the owner, plus friends when wall_posting = 'friends'.
--   Each owner post:    its own audience (null = the wall's). Friends' posts
--                       always follow the wall.
--   Comments:           any signed-in member who can see the post.
--   Blocks:             a block between the viewer and the author, or between
--                       the wall owner and the author, hides the item.
--   Photos:             member_photos kind 'wall' (stripped like every photo,
--                       stored on R2). Stored as only_me; the media route
--                       serves one only to viewers who can see its post.
--
-- Every read is RLS (anon + authenticated SELECT, filtered by the same
-- functions the RPCs use). Every write is a SECURITY DEFINER RPC with a daily
-- backstop under the server actions' hourly rate limits. Reports go through
-- content_reports (new targets wall_post, wall_comment); 3 open reports hide a
-- post or comment until a moderator decides.
--
-- Rollback:
--   drop function public.get_wall, public.get_wall_comments, public.wall_access,
--     public.create_wall_post, public.delete_wall_post, public.create_wall_comment,
--     public.delete_wall_comment, public.notify_wall, public.wall_comment_visible,
--     public.wall_post_visible, public.can_view_wall, public.blocked_either_way;
--   drop table public.wall_comments, public.wall_posts;
--   alter table public.profile_social drop column wall_audience, drop column wall_posting;
--   restore 0288's content_reports_type_chk + report_content, 0286's
--   member_photos_kind_chk + get_media_object + get_profile_photos, and 0285's
--   get_my_profile_social.

-- ---- 1. settings ---------------------------------------------------------------
alter table public.profile_social
  add column if not exists wall_audience text not null default 'members',
  add column if not exists wall_posting  text not null default 'friends';
alter table public.profile_social drop constraint if exists profile_social_wall_chk;
alter table public.profile_social add constraint profile_social_wall_chk check (
  wall_audience in ('only_me', 'friends', 'members', 'public') and wall_posting in ('only_me', 'friends'));
grant insert (wall_audience, wall_posting), update (wall_audience, wall_posting)
  on public.profile_social to authenticated;

drop function if exists public.get_my_profile_social();
create function public.get_my_profile_social()
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
  profile_visibility text,
  wall_audience text,
  wall_posting text
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
         p.profile_visibility,
         coalesce(ps.wall_audience, public.default_profile_audience(p.profile_visibility)),
         coalesce(ps.wall_posting, 'friends')
    from public.profiles p
    left join public.profile_social ps on ps.user_id = p.id
   where p.id = auth.uid();
$$;
revoke all on function public.get_my_profile_social() from public, anon;
grant execute on function public.get_my_profile_social() to authenticated;

-- ---- 2. wall photos --------------------------------------------------------------
alter table public.member_photos drop constraint if exists member_photos_kind_chk;
alter table public.member_photos add constraint member_photos_kind_chk
  check (kind in ('avatar', 'cover', 'album', 'wall'));

-- ---- 3. tables -------------------------------------------------------------------
create table if not exists public.wall_posts (
  id            uuid primary key default gen_random_uuid(),
  wall_owner_id uuid not null references public.profiles(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  body          text not null,
  photo_id      uuid references public.member_photos(id) on delete set null,
  audience      text,
  status        text not null default 'active',
  report_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint wall_posts_body_len check (char_length(btrim(body)) between 1 and 2000),
  constraint wall_posts_audience_chk check (audience is null or audience in ('only_me', 'friends', 'members', 'public')),
  constraint wall_posts_status_chk check (status in ('active', 'hidden', 'removed'))
);
create unique index if not exists ux_wall_posts_photo on public.wall_posts (photo_id) where photo_id is not null;
create index if not exists ix_wall_posts_wall on public.wall_posts (wall_owner_id, created_at desc) where deleted_at is null;
create index if not exists ix_wall_posts_author on public.wall_posts (author_id, created_at desc);

create table if not exists public.wall_comments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.wall_posts(id) on delete cascade,
  author_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null,
  status       text not null default 'active',
  report_count integer not null default 0,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint wall_comments_body_len check (char_length(btrim(body)) between 1 and 1000),
  constraint wall_comments_status_chk check (status in ('active', 'hidden', 'removed'))
);
create index if not exists ix_wall_comments_post on public.wall_comments (post_id, created_at) where deleted_at is null;
create index if not exists ix_wall_comments_author on public.wall_comments (author_id, created_at desc);

-- ---- 4. the visibility rules -------------------------------------------------------
create or replace function public.blocked_either_way(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_a is not null and p_b is not null and exists (
    select 1 from public.user_blocks b
     where (b.blocker_id = p_a and b.blocked_id = p_b)
        or (b.blocker_id = p_b and b.blocked_id = p_a));
$$;

-- Never wider than the profile itself.
create or replace function public.can_view_wall(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.can_view_audience(p.id, coalesce(ps.profile_audience, public.default_profile_audience(p.profile_visibility)))
       and public.can_view_audience(p.id, coalesce(ps.wall_audience, public.default_profile_audience(p.profile_visibility)))
      from public.profiles p
      left join public.profile_social ps on ps.user_id = p.id
     where p.id = p_owner), false);
$$;

create or replace function public.wall_post_visible(p_owner uuid, p_author uuid, p_audience text, p_status text, p_deleted timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_deleted is null and p_status = 'active' and (
    (auth.uid() is not null and auth.uid() = p_owner)
    or (auth.uid() is not null and auth.uid() = p_author and not public.blocked_either_way(p_author, p_owner))
    or (public.can_view_wall(p_owner)
        and (p_audience is null or public.can_view_audience(p_owner, p_audience))
        and not public.blocked_either_way(p_author, auth.uid())
        and not public.blocked_either_way(p_author, p_owner))
  );
$$;

create or replace function public.wall_comment_visible(p_post uuid, p_author uuid, p_status text, p_deleted timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_deleted is null and p_status = 'active'
     and not public.blocked_either_way(p_author, auth.uid())
     and exists (
       select 1 from public.wall_posts w
        where w.id = p_post
          and not public.blocked_either_way(p_author, w.wall_owner_id)
          and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at));
$$;

-- 'post' | 'view' | 'none' for the current viewer.
create or replace function public.wall_access(p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.can_view_wall(p_owner) then 'none'
    when auth.uid() is null then 'view'
    when auth.uid() = p_owner then 'post'
    when coalesce((select ps.wall_posting from public.profile_social ps where ps.user_id = p_owner), 'friends') = 'friends'
         and exists (select 1 from public.member_connections c
                      where c.status = 'accepted'
                        and ((c.requester_id = p_owner and c.addressee_id = auth.uid())
                          or (c.requester_id = auth.uid() and c.addressee_id = p_owner)))
      then 'post'
    else 'view'
  end;
$$;

-- An author's @handle on someone else's wall: only when they are discoverable,
-- or the viewer is them, the wall owner, or their friend. Otherwise null and
-- the page shows a generic label.
create or replace function public.wall_author_handle(p_author uuid, p_owner uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.username from public.profiles a
   where a.id = p_author
     and (a.profile_visibility = 'public'
          or auth.uid() in (p_author, p_owner)
          or public.can_view_audience(p_author, 'friends'));
$$;

-- ---- 5. RLS ------------------------------------------------------------------------
alter table public.wall_posts enable row level security;
alter table public.wall_comments enable row level security;

drop policy if exists wall_posts_read on public.wall_posts;
create policy wall_posts_read on public.wall_posts
  for select to anon, authenticated
  using (public.wall_post_visible(wall_owner_id, author_id, audience, status, deleted_at));

drop policy if exists wall_comments_read on public.wall_comments;
create policy wall_comments_read on public.wall_comments
  for select to anon, authenticated
  using (public.wall_comment_visible(post_id, author_id, status, deleted_at));

revoke all on public.wall_posts from anon, authenticated;
revoke all on public.wall_comments from anon, authenticated;
grant select on public.wall_posts to anon, authenticated;
grant select on public.wall_comments to anon, authenticated;
grant all on public.wall_posts to service_role;
grant all on public.wall_comments to service_role;

-- ---- 6. reads ----------------------------------------------------------------------
create or replace function public.get_wall(p_owner uuid, p_before timestamptz default null, p_limit integer default 20)
returns table (
  id uuid,
  author_id uuid,
  author_username text,
  author_avatar_url text,
  body text,
  photo_url text,
  audience text,
  created_at timestamptz,
  comment_count integer,
  can_delete boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.author_id,
         public.wall_author_handle(w.author_id, w.wall_owner_id),
         public.visible_avatar_url(w.author_id),
         w.body,
         case when exists (select 1 from public.member_photos m where m.id = w.photo_id and m.status = 'active')
              then '/api/media/' || w.photo_id::text end,
         case when auth.uid() = w.wall_owner_id then w.audience end,
         w.created_at,
         (select count(*)::int from public.wall_comments c
           where c.post_id = w.id and c.deleted_at is null and c.status = 'active'
             and not public.blocked_either_way(c.author_id, auth.uid())
             and not public.blocked_either_way(c.author_id, w.wall_owner_id)),
         auth.uid() is not null and auth.uid() in (w.wall_owner_id, w.author_id)
    from public.wall_posts w
   where w.wall_owner_id = p_owner
     and (p_before is null or w.created_at < p_before)
     and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at)
   order by w.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

create or replace function public.get_wall_comments(p_post uuid)
returns table (
  id uuid,
  author_id uuid,
  author_username text,
  author_avatar_url text,
  body text,
  created_at timestamptz,
  can_delete boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.author_id,
         public.wall_author_handle(c.author_id, w.wall_owner_id),
         public.visible_avatar_url(c.author_id),
         c.body, c.created_at,
         auth.uid() is not null and auth.uid() in (c.author_id, w.author_id, w.wall_owner_id)
    from public.wall_comments c
    join public.wall_posts w on w.id = c.post_id
   where c.post_id = p_post
     and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at)
     and c.deleted_at is null and c.status = 'active'
     and not public.blocked_either_way(c.author_id, auth.uid())
     and not public.blocked_either_way(c.author_id, w.wall_owner_id)
   order by c.created_at
   limit 200;
$$;

-- ---- 7. writes ---------------------------------------------------------------------
create or replace function public.notify_wall(p_to uuid, p_from uuid, p_kind text, p_link text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_handle text;
begin
  if p_to is null or p_to = p_from then
    return;
  end if;
  if exists (select 1 from public.notification_preferences np where np.user_id = p_to and np.notify_community = false) then
    return;
  end if;
  select '@' || coalesce(pr.username, 'member') into v_handle from public.profiles pr where pr.id = p_from;
  insert into public.notifications (user_id, kind, title, body, link)
  values (
    p_to,
    p_kind,
    case p_kind when 'wall_post' then v_handle || ' posted on your wall' else v_handle || ' commented on your post' end,
    'Open it to read and reply.',
    p_link
  );
exception when others then
  -- A notification must never block the post itself.
  raise warning 'notify_wall failed: %', sqlerrm;
end;
$$;

-- Returns the new post id, or null when refused (can't post here, bad photo,
-- bad length). Never says why, so it can't probe another member's settings.
create or replace function public.create_wall_post(p_owner uuid, p_body text, p_photo uuid default null, p_audience text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if v_me is null then
    raise exception 'sign in to post';
  end if;
  if char_length(v_body) not between 1 and 2000 then
    return null;
  end if;
  if public.wall_access(p_owner) <> 'post' then
    return null;
  end if;
  if p_audience is not null and (v_me <> p_owner or p_audience not in ('only_me', 'friends', 'members', 'public')) then
    return null;
  end if;
  if p_photo is not null and (
       not exists (select 1 from public.member_photos m
                    where m.id = p_photo and m.owner_id = v_me and m.kind = 'wall' and m.status = 'active')
       or exists (select 1 from public.wall_posts w where w.photo_id = p_photo)) then
    return null;
  end if;
  if (select count(*) from public.wall_posts w
       where w.author_id = v_me and w.created_at > now() - interval '1 day') >= 50 then
    raise exception 'too many posts today';
  end if;

  insert into public.wall_posts (wall_owner_id, author_id, body, photo_id, audience)
  values (p_owner, v_me, v_body, p_photo, p_audience)
  returning id into v_id;
  perform public.notify_wall(p_owner, v_me, 'wall_post', '/profile/' || p_owner::text);
  return v_id;
end;
$$;

-- The author or the wall owner. Zero rows = refused; one row = deleted, with
-- the attached photo (if any) so the server can delete its R2 object.
create or replace function public.delete_wall_post(p_id uuid)
returns table (photo_id uuid, photo_owner uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_photo uuid;
  v_author uuid;
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;
  update public.wall_posts w set deleted_at = now()
   where w.id = p_id and w.deleted_at is null and v_me in (w.wall_owner_id, w.author_id)
  returning w.photo_id, w.author_id into v_photo, v_author;
  if not found then
    return;
  end if;
  update public.member_photos m set status = 'removed' where m.id = v_photo;
  photo_id := v_photo;
  photo_owner := case when v_photo is null then null else v_author end;
  return next;
end;
$$;

create or replace function public.create_wall_comment(p_post uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_owner uuid;
  v_author uuid;
  v_id uuid;
begin
  if v_me is null then
    raise exception 'sign in to comment';
  end if;
  if char_length(v_body) not between 1 and 1000 then
    return null;
  end if;
  select w.wall_owner_id, w.author_id into v_owner, v_author
    from public.wall_posts w
   where w.id = p_post
     and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at);
  if v_owner is null or public.blocked_either_way(v_me, v_owner) or public.blocked_either_way(v_me, v_author) then
    return null;
  end if;
  if (select count(*) from public.wall_comments c
       where c.author_id = v_me and c.created_at > now() - interval '1 day') >= 200 then
    raise exception 'too many comments today';
  end if;

  insert into public.wall_comments (post_id, author_id, body)
  values (p_post, v_me, v_body)
  returning id into v_id;
  perform public.notify_wall(v_author, v_me, 'wall_comment', '/profile/' || v_owner::text);
  return v_id;
end;
$$;

-- The comment's author, the post's author, or the wall owner.
create or replace function public.delete_wall_comment(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'sign in first';
  end if;
  update public.wall_comments c set deleted_at = now()
    from public.wall_posts w
   where c.id = p_id and w.id = c.post_id and c.deleted_at is null
     and v_me in (c.author_id, w.author_id, w.wall_owner_id);
  return found;
end;
$$;

revoke all on function public.blocked_either_way(uuid, uuid) from public;
revoke all on function public.can_view_wall(uuid) from public;
revoke all on function public.wall_post_visible(uuid, uuid, text, text, timestamptz) from public;
revoke all on function public.wall_comment_visible(uuid, uuid, text, timestamptz) from public;
revoke all on function public.wall_access(uuid) from public;
revoke all on function public.wall_author_handle(uuid, uuid) from public;
revoke all on function public.get_wall(uuid, timestamptz, integer) from public;
revoke all on function public.get_wall_comments(uuid) from public;
revoke all on function public.notify_wall(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_wall_post(uuid, text, uuid, text) from public, anon;
revoke all on function public.delete_wall_post(uuid) from public, anon;
revoke all on function public.create_wall_comment(uuid, text) from public, anon;
revoke all on function public.delete_wall_comment(uuid) from public, anon;
-- The RLS policies call these as the querying role, so anon needs them too.
grant execute on function public.blocked_either_way(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.can_view_wall(uuid) to anon, authenticated, service_role;
grant execute on function public.wall_post_visible(uuid, uuid, text, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.wall_comment_visible(uuid, uuid, text, timestamptz) to anon, authenticated, service_role;
grant execute on function public.wall_access(uuid) to anon, authenticated, service_role;
grant execute on function public.wall_author_handle(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.get_wall(uuid, timestamptz, integer) to anon, authenticated, service_role;
grant execute on function public.get_wall_comments(uuid) to anon, authenticated, service_role;
grant execute on function public.notify_wall(uuid, uuid, text, text) to service_role;
grant execute on function public.create_wall_post(uuid, text, uuid, text) to authenticated, service_role;
grant execute on function public.delete_wall_post(uuid) to authenticated, service_role;
grant execute on function public.create_wall_comment(uuid, text) to authenticated, service_role;
grant execute on function public.delete_wall_comment(uuid) to authenticated, service_role;

-- ---- 8. wall photos: served only alongside a visible post; never in the album ----
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
          or (m.status = 'active' and m.kind <> 'wall' and public.can_view_audience(m.owner_id, m.audience))
          or (m.status = 'active' and m.kind = 'wall' and exists (
                select 1 from public.wall_posts w
                 where w.photo_id = m.id
                   and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at))));
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
     and m.kind <> 'wall'
     and (m.owner_id = auth.uid() or (m.status = 'active' and public.can_view_audience(m.owner_id, m.audience)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 60), 120));
$$;

-- ---- 9. reports: two new targets ------------------------------------------------------
-- Built on the LIVE definition after 0291 and 0293 (B4c's group_chat_message
-- and group_resource branches are kept; 0293 was applied before this file).
-- Any later migration that re-creates report_content must start from the live
-- definition: pg_get_functiondef('public.report_content(text,text,text,text)'::regprocedure).
alter table public.content_reports drop constraint if exists content_reports_type_chk;
alter table public.content_reports add constraint content_reports_type_chk check (target_type in (
  'member_photo', 'profile', 'lounge_message', 'story', 'community_video',
  'dm_user', 'group_post', 'group_thread', 'group_event', 'group_chat_message', 'group_resource',
  'wall_post', 'wall_comment'));

create or replace function public.report_content(p_type text, p_id text, p_reason text, p_note text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_seen boolean := false;
  v_uuid uuid;
  v_open int;
begin
  if v_me is null then
    raise exception 'sign in to report';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,64}$' then
    return false;
  end if;
  if p_type <> 'community_video' then
    begin
      v_uuid := p_id::uuid;
    exception when invalid_text_representation then
      return false;
    end;
  end if;
  -- Backstop under the server action's per-day rate limit.
  if (select count(*) from public.content_reports r
       where r.reporter_id = v_me and r.created_at > now() - interval '1 day') >= 100 then
    raise exception 'too many reports today';
  end if;

  -- Resolve the owner AND prove the reporter can see the target.
  if p_type = 'member_photo' then
    select m.owner_id, true into v_owner, v_seen from public.member_photos m
     where m.id = v_uuid and m.status = 'active' and public.can_view_audience(m.owner_id, m.audience);
  elsif p_type = 'profile' then
    select pr.id, true into v_owner, v_seen
      from public.profiles pr left join public.profile_social ps on ps.user_id = pr.id
     where pr.id = v_uuid
       and not exists (select 1 from public.user_blocks b where b.blocker_id = pr.id and b.blocked_id = v_me)
       and (pr.profile_visibility = 'public'
            or public.can_view_audience(pr.id, coalesce(ps.profile_audience, public.default_profile_audience(pr.profile_visibility))));
  elsif p_type = 'dm_user' then
    select v_uuid, true into v_owner, v_seen
     where exists (select 1 from public.dm_participants a join public.dm_participants b on b.conversation_id = a.conversation_id
                    where a.user_id = v_me and b.user_id = v_uuid);
  elsif p_type = 'lounge_message' then
    select c.user_id, true into v_owner, v_seen from public.chat_messages c where c.id = v_uuid;
  elsif p_type = 'story' then
    select s.author_id, true into v_owner, v_seen from public.kratom_stories s
     where s.id = v_uuid and s.moderation_status = 'approved' and s.deleted_at is null;
  elsif p_type = 'community_video' then
    select null::uuid, true into v_owner, v_seen from public.community_videos v
     where v.video_id = p_id and not coalesce(v.hidden, false);
  elsif p_type = 'group_post' then
    select g.author_id, true into v_owner, v_seen from public.coalition_posts g
     where g.id = v_uuid and g.deleted_at is null and public.is_coalition_member(g.coalition_id);
  elsif p_type = 'group_thread' then
    select g.author_id, true into v_owner, v_seen from public.coalition_threads g
     where g.id = v_uuid and g.deleted_at is null and public.is_coalition_member(g.coalition_id);
  elsif p_type = 'group_event' then
    select g.created_by, true into v_owner, v_seen from public.coalition_events g
     where g.id = v_uuid and public.is_coalition_member(g.coalition_id);
  elsif p_type = 'group_chat_message' then
    select g.user_id, true into v_owner, v_seen from public.coalition_chat_messages g
     where g.id = v_uuid and public.is_coalition_member(g.coalition_id);
  elsif p_type = 'group_resource' then
    select g.created_by, true into v_owner, v_seen from public.coalition_resources g
     where g.id = v_uuid and public.is_coalition_member(g.coalition_id);
  elsif p_type = 'wall_post' then
    select w.author_id, true into v_owner, v_seen from public.wall_posts w
     where w.id = v_uuid and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at);
  elsif p_type = 'wall_comment' then
    select c.author_id, true into v_owner, v_seen from public.wall_comments c
     where c.id = v_uuid and public.wall_comment_visible(c.post_id, c.author_id, c.status, c.deleted_at);
  else
    return false;
  end if;

  if not coalesce(v_seen, false) or v_owner = v_me then
    return false;
  end if;

  insert into public.content_reports (target_type, target_id, target_owner_id, reporter_id, reason, note)
  values (p_type, p_id, v_owner, v_me, p_reason, nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  on conflict (target_type, target_id, reporter_id) do nothing;

  -- Photos, wall posts and wall comments hide at 3 open reports.
  if p_type in ('member_photo', 'wall_post', 'wall_comment') then
    select count(*)::int into v_open from public.content_reports r
     where r.target_type = p_type and r.target_id = p_id and r.status = 'open';
    if p_type = 'member_photo' then
      update public.member_photos
         set report_count = v_open,
             status = case when v_open >= 3 and status = 'active' then 'hidden' else status end
       where id = v_uuid;
    elsif p_type = 'wall_post' then
      update public.wall_posts
         set report_count = v_open,
             status = case when v_open >= 3 and status = 'active' then 'hidden' else status end
       where id = v_uuid;
    else
      update public.wall_comments
         set report_count = v_open,
             status = case when v_open >= 3 and status = 'active' then 'hidden' else status end
       where id = v_uuid;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.report_content(text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text) to authenticated, service_role;

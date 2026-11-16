-- 0318_group_images_and_stats.sql
--
-- Three things from PJ's meme and infographic group (2026-11-06).
--
-- 1. "Officials the group wrote to" counted letters from before a member joined,
--    so a brand-new group showed its founder's old sends. It now counts from
--    joined_at, the same rule as coalition_wins.
--
-- 2. get_public_profile(s) returned nothing for a member with a non-public
--    profile, even to that member, so they saw themselves as "Member". You can
--    always see your own handle now. Other people still can't.
--
-- 3. Groups can post images. A group photo is a member_photos row of kind
--    'group', stored as only_me like a wall photo: get_media_object serves it to
--    members of the group whose post holds it, and stops when that post is
--    removed. The post's author must own the photo, so nobody can attach
--    someone else's image to read it. Images live on R2, which has free egress.
--
-- Also lets a post be image-only, and adds edited_at so a group post can be
-- edited the way a forum post can.
--
-- Rollback:
--   alter table public.coalition_threads drop column if exists photo_id, drop column if exists edited_at;
--   alter table public.coalition_posts drop column if exists photo_id, drop column if exists edited_at;
--   restore coalition_threads_body_check and coalition_posts_body_check with (char_length(body) >= 1 and <= 5000);
--   restore member_photos_kind_chk without 'group' (delete group rows first);
--   re-run coalition_top_legislators from 0156, get_public_profile(s) and get_media_object from 0292.

create or replace function public.coalition_top_legislators(
  p_coalition_id uuid,
  p_days int default 7,
  p_limit int default 8
)
returns table (
  legislator_id uuid,
  full_name text,
  state text,
  role text,
  send_count bigint,
  distinct_senders bigint
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.is_coalition_member(p_coalition_id) then
    raise exception 'not a member of this coalition';
  end if;

  return query
    select
      l.id                                   as legislator_id,
      l.full_name,
      l.state,
      l.role,
      count(ca.id)::bigint                   as send_count,
      count(distinct ca.user_id)::bigint     as distinct_senders
    from public.campaign_actions ca
    join public.coalition_members cm
      on cm.user_id = ca.user_id
     and cm.coalition_id = p_coalition_id
    join public.legislators l on l.id = ca.legislator_id
    where ca.sent_at > now() - (p_days || ' days')::interval
      and ca.sent_at >= cm.joined_at
    group by l.id, l.full_name, l.state, l.role
    order by send_count desc, distinct_senders desc
    limit p_limit;
end;
$$;

create or replace function public.get_public_profile(p_id uuid)
returns table(id uuid, username text, state text, avatar_url text, is_admin boolean, is_advocate_leader boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.username, p.state, public.visible_avatar_url(p.id), p.is_admin, p.is_advocate_leader
    from public.profiles p
   where p.id = p_id
     and (p.profile_visibility = 'public' or p.id = auth.uid());
$function$;

create or replace function public.get_public_profiles(p_ids uuid[])
returns table(id uuid, username text, state text, avatar_url text, is_admin boolean, is_advocate_leader boolean)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.username, p.state, public.visible_avatar_url(p.id), p.is_admin, p.is_advocate_leader
    from public.profiles p
   where p.id = any(p_ids)
     and (p.profile_visibility = 'public' or p.id = auth.uid());
$function$;

alter table public.member_photos drop constraint if exists member_photos_kind_chk;
alter table public.member_photos add constraint member_photos_kind_chk
  check (kind = any (array['avatar'::text, 'cover'::text, 'album'::text, 'wall'::text, 'group'::text]));

alter table public.coalition_threads
  add column if not exists photo_id uuid references public.member_photos(id) on delete set null,
  add column if not exists edited_at timestamptz;
alter table public.coalition_posts
  add column if not exists photo_id uuid references public.member_photos(id) on delete set null,
  add column if not exists edited_at timestamptz;

create index if not exists coalition_threads_photo_idx
  on public.coalition_threads (photo_id) where photo_id is not null;
create index if not exists coalition_posts_photo_idx
  on public.coalition_posts (photo_id) where photo_id is not null;

alter table public.coalition_threads drop constraint if exists coalition_threads_body_check;
alter table public.coalition_threads add constraint coalition_threads_body_check
  check (char_length(body) <= 5000);
alter table public.coalition_posts drop constraint if exists coalition_posts_body_check;
alter table public.coalition_posts add constraint coalition_posts_body_check
  check (char_length(body) <= 5000);

create or replace function public.get_media_object(p_id uuid)
returns table(r2_key text, content_type text, audience text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select m.r2_key, m.content_type, m.audience
    from public.member_photos m
   where m.id = p_id
     and (m.owner_id = auth.uid()
          or public.is_admin(auth.uid())
          or (m.status = 'active' and m.kind not in ('wall', 'group') and public.can_view_audience(m.owner_id, m.audience))
          or (m.status = 'active' and m.kind = 'wall' and exists (
                select 1 from public.wall_posts w
                 where w.photo_id = m.id
                   and public.wall_post_visible(w.wall_owner_id, w.author_id, w.audience, w.status, w.deleted_at)))
          or (m.status = 'active' and m.kind = 'group' and (
                exists (select 1 from public.coalition_threads t
                         where t.photo_id = m.id and t.author_id = m.owner_id and t.deleted_at is null
                           and public.is_coalition_member(t.coalition_id))
                or exists (select 1 from public.coalition_posts c
                            where c.photo_id = m.id and c.author_id = m.owner_id and c.deleted_at is null
                              and public.is_coalition_member(c.coalition_id)))));
$function$;

-- A group image belongs to its post, not to the member's photo album.
create or replace function public.get_profile_photos(p_owner uuid, p_limit integer default 60)
returns table(id uuid, kind text, caption text, width integer, height integer, audience text, created_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  select m.id, m.kind, m.caption, m.width, m.height,
         case when m.owner_id = auth.uid() then m.audience end,
         m.created_at
    from public.member_photos m
   where m.owner_id = p_owner
     and m.kind not in ('wall', 'group')
     and (m.owner_id = auth.uid() or (m.status = 'active' and public.can_view_audience(m.owner_id, m.audience)))
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limit, 60), 120));
$function$;

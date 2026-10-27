-- 0296_report_content_restate.sql
--
-- Intent: 0292 (profile wall) was APPLIED after 0293 (group resources), so the
-- live content_reports_type_chk and report_content() are correct (13 targets).
-- But the FILES replay in name order, and 0293 re-creates both WITHOUT
-- wall_post / wall_comment, so a fresh replay would silently drop wall reports.
-- This restates the live definitions (pg_get_functiondef, 2026-10-27) so the
-- newest file is the authority again. On the live DB it is a no-op.
--
-- Rollback: none needed (identical to the live definitions). Any later
-- migration that re-creates report_content must start from the live definition.

alter table public.content_reports drop constraint if exists content_reports_type_chk;
alter table public.content_reports add constraint content_reports_type_chk check (target_type in (
  'member_photo', 'profile', 'lounge_message', 'story', 'community_video',
  'dm_user', 'group_post', 'group_thread', 'group_event', 'group_chat_message', 'group_resource',
  'wall_post', 'wall_comment'));

create or replace function public.report_content(p_type text, p_id text, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

revoke all on function public.report_content(text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text) to authenticated, service_role;

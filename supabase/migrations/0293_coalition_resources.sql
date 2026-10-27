-- 0293_coalition_resources.sql
--
-- Pinned resources + testimony templates (B4 h, owner ask 2026-10-27).
-- A group's organizers pin what members keep asking for: links (the hearing
-- page, the testimony portal, a fact sheet) and letter/testimony templates.
-- A template opens the shared uniform composer (src/modules/compose), filled
-- with each member's own details and addressed to their own officials; it is
-- never a hand-rolled mailto.
--
-- Members read; only the group's owner/admins pin, edit and remove (site
-- admins can remove, for moderation). Links are http(s) only. 30 per group.
-- An update can't move a resource to another group or change who pinned it,
-- so a report always lands on the right organizer.
--
-- Reports: a new target, group_resource, on the ONE report system (0288);
-- report_content() is replaced whole with one more branch (same body as 0291).
--
-- Rollback:
--   drop table public.coalition_resources;
--   drop function public.coalition_resources_guard();
--   restore 0291's content_reports_type_chk and report_content body.

create table if not exists public.coalition_resources (
  id            uuid primary key default gen_random_uuid(),
  coalition_id  uuid not null references public.coalitions(id) on delete cascade,
  created_by    uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('link', 'template')),
  title         text not null check (char_length(title) between 3 and 120),
  note          text check (note is null or char_length(note) <= 500),
  url           text check (url is null or (char_length(url) <= 2000 and url ~* '^https?://[^[:space:]]+$')),
  subject       text check (subject is null or char_length(subject) between 1 and 200),
  body          text check (body is null or char_length(body) between 1 and 5000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint coalition_resources_shape check (
    (kind = 'link' and url is not null and body is null)
    or (kind = 'template' and body is not null))
);
create index if not exists ix_coalition_resources_group
  on public.coalition_resources (coalition_id, created_at desc);

alter table public.coalition_resources enable row level security;

drop policy if exists "coalition_resources: members read" on public.coalition_resources;
create policy "coalition_resources: members read" on public.coalition_resources
  for select to authenticated
  using (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

drop policy if exists "coalition_resources: organizers pin" on public.coalition_resources;
create policy "coalition_resources: organizers pin" on public.coalition_resources
  for insert to authenticated
  with check (created_by = auth.uid() and public.is_coalition_admin(coalition_id));

drop policy if exists "coalition_resources: organizers edit" on public.coalition_resources;
create policy "coalition_resources: organizers edit" on public.coalition_resources
  for update to authenticated
  using (public.is_coalition_admin(coalition_id))
  with check (public.is_coalition_admin(coalition_id));

drop policy if exists "coalition_resources: organizers remove" on public.coalition_resources;
create policy "coalition_resources: organizers remove" on public.coalition_resources
  for delete to authenticated
  using (public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()));

revoke all on public.coalition_resources from anon, authenticated;
grant select, insert, update, delete on public.coalition_resources to authenticated;
grant all on public.coalition_resources to service_role;

-- The cap, and an update that can't re-home or re-attribute a resource.
create or replace function public.coalition_resources_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.coalition_resources r where r.coalition_id = new.coalition_id) >= 30 then
      raise exception 'a group can pin up to 30 resources' using errcode = 'check_violation';
    end if;
  else
    new.coalition_id := old.coalition_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function public.coalition_resources_guard() from public, anon, authenticated;

drop trigger if exists trg_coalition_resources_guard on public.coalition_resources;
create trigger trg_coalition_resources_guard
  before insert or update on public.coalition_resources
  for each row execute function public.coalition_resources_guard();

-- ---- the report target --------------------------------------------------------
alter table public.content_reports drop constraint if exists content_reports_type_chk;
alter table public.content_reports add constraint content_reports_type_chk check (target_type in (
    'member_photo', 'profile', 'lounge_message', 'story', 'community_video',
    'dm_user', 'group_post', 'group_thread', 'group_event', 'group_chat_message', 'group_resource'));

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
  else
    return false;
  end if;

  if not coalesce(v_seen, false) or v_owner = v_me then
    return false;
  end if;

  insert into public.content_reports (target_type, target_id, target_owner_id, reporter_id, reason, note)
  values (p_type, p_id, v_owner, v_me, p_reason, nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  on conflict (target_type, target_id, reporter_id) do nothing;

  if p_type = 'member_photo' then
    select count(*)::int into v_open from public.content_reports r
     where r.target_type = 'member_photo' and r.target_id = p_id and r.status = 'open';
    update public.member_photos
       set report_count = v_open,
           status = case when v_open >= 3 and status = 'active' then 'hidden' else status end
     where id = v_uuid;
  end if;
  return true;
end;
$$;

revoke all on function public.report_content(text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text) to authenticated, service_role;

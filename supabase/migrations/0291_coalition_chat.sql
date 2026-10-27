-- 0291_coalition_chat.sql
--
-- Live group chat (B4 e, owner ask 2026-10-27): a realtime room per group, on
-- the Lounge pattern (0039 + 0041). The board (0273) is for long-form; this is
-- the quick back-and-forth a group needs on a call-in day.
--
-- Members of the group read and write; nobody else sees a word (site admins
-- can read, for moderation). The author, the group's organizers and site
-- admins can delete. Authors render by @username only (get_public_profiles).
--
-- Realtime: postgres_changes evaluates the SELECT policy for each subscriber,
-- so the client must setAuth(jwt) before subscribing (policy is `to
-- authenticated`). The client filters on coalition_id, a non-PK column, so
-- DELETE events need REPLICA IDENTITY FULL to carry it (AGENTS.md pitfall 2).
--
-- Reports: a new target, group_chat_message, on the ONE report system (0288).
-- report_content() is replaced whole with one more branch; nothing else in it
-- changes.
--
-- Rollback:
--   alter publication supabase_realtime drop table public.coalition_chat_messages;
--   drop table public.coalition_chat_messages;
--   restore 0288's content_reports_type_chk and report_content body.

create table if not exists public.coalition_chat_messages (
  id            uuid primary key default gen_random_uuid(),
  coalition_id  uuid not null references public.coalitions(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  body          text not null check (char_length(body) between 1 and 500),
  created_at    timestamptz not null default now()
);
create index if not exists ix_coalition_chat_room
  on public.coalition_chat_messages (coalition_id, created_at desc);
-- The "same body from the same member in the last minute" check.
create index if not exists ix_coalition_chat_dup
  on public.coalition_chat_messages (user_id, created_at desc);

alter table public.coalition_chat_messages enable row level security;
alter table public.coalition_chat_messages replica identity full;

drop policy if exists "coalition_chat: members read" on public.coalition_chat_messages;
create policy "coalition_chat: members read" on public.coalition_chat_messages
  for select to authenticated
  using (public.is_coalition_member(coalition_id) or public.is_admin(auth.uid()));

drop policy if exists "coalition_chat: members post" on public.coalition_chat_messages;
create policy "coalition_chat: members post" on public.coalition_chat_messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_coalition_member(coalition_id));

drop policy if exists "coalition_chat: author or organizer deletes" on public.coalition_chat_messages;
create policy "coalition_chat: author or organizer deletes" on public.coalition_chat_messages
  for delete to authenticated
  using (user_id = auth.uid() or public.is_coalition_admin(coalition_id) or public.is_admin(auth.uid()));

-- Explicit grants (required for new public tables from 2026-10-30). No UPDATE:
-- a chat line is posted or deleted, never edited.
revoke all on public.coalition_chat_messages from anon, authenticated;
grant select, insert, delete on public.coalition_chat_messages to authenticated;
grant all on public.coalition_chat_messages to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'coalition_chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.coalition_chat_messages';
  end if;
end $$;

-- ---- the report target --------------------------------------------------------
alter table public.content_reports drop constraint if exists content_reports_type_chk;
alter table public.content_reports add constraint content_reports_type_chk check (target_type in (
    'member_photo', 'profile', 'lounge_message', 'story', 'community_video',
    'dm_user', 'group_post', 'group_thread', 'group_event', 'group_chat_message'));

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

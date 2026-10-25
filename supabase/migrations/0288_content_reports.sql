-- ============================================================
-- 0288 — content_reports: ONE report system for every member surface
-- ============================================================
-- Owner requirement (10-24, via trunk): a report button on every photo and
-- every post, feeding the moderation queue, as ONE generic system.
--
--   report_content(target_type, target_id, reason, note) → boolean
--     SECURITY DEFINER. Refuses (false) unless the reporter can actually SEE the
--     target, and never for your own content. One report per reporter per
--     target (a repeat is a no-op). The note doubles as the pasted excerpt for
--     DMs, which are end-to-end encrypted, so the server never reads them.
--
-- Targets: member_photo, profile, lounge_message, story, community_video,
-- dm_user (a member you share a conversation with), group_post, group_thread,
-- group_event. The forum keeps forum_post_reports (0022): it is wired into the
-- forum's own flag/approve/remove flow, so the admin queue shows its open count
-- beside this table instead of a second copy of those rows.
--
-- This replaces 0286's member_photo_reports (folded in here, then dropped).
-- report_member_photo() stays as a thin wrapper. A member photo with 3 open
-- reports from different members is hidden until a moderator decides.
--
-- Reads: admins only (RLS). Writes: the RPC for members; service role for the
-- admin resolve actions.
--
-- Rollback:
--   drop function if exists public.report_content(text, text, text, text);
--   restore 0286's member_photo_reports table + report_member_photo body;
--   drop table if exists public.content_reports;

create table if not exists public.content_reports (
  id              uuid primary key default gen_random_uuid(),
  target_type     text not null,
  target_id       text not null,
  target_owner_id uuid references public.profiles(id) on delete set null,
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  reason          text not null,
  note            text,
  status          text not null default 'open',
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolution      text,
  created_at      timestamptz not null default now(),
  constraint content_reports_type_chk check (target_type in (
    'member_photo', 'profile', 'lounge_message', 'story', 'community_video',
    'dm_user', 'group_post', 'group_thread', 'group_event')),
  constraint content_reports_target_id_chk check (target_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint content_reports_reason_chk check (reason in (
    'harassment', 'personal_info', 'nudity', 'violence', 'spam', 'misinformation', 'other')),
  constraint content_reports_note_len check (note is null or char_length(note) <= 1000),
  constraint content_reports_status_chk check (status in ('open', 'actioned', 'dismissed')),
  constraint content_reports_one_per_reporter unique (target_type, target_id, reporter_id)
);

create index if not exists ix_content_reports_open
  on public.content_reports (created_at desc) where status = 'open';
create index if not exists ix_content_reports_target
  on public.content_reports (target_type, target_id);
create index if not exists ix_content_reports_reporter
  on public.content_reports (reporter_id, created_at desc);

alter table public.content_reports enable row level security;

drop policy if exists content_reports_admin_read on public.content_reports;
create policy content_reports_admin_read on public.content_reports
  for select to authenticated
  using (public.is_admin(auth.uid()));

revoke all on public.content_reports from anon, authenticated;
grant select on public.content_reports to authenticated;
grant all on public.content_reports to service_role;

-- ---- the one write path -----------------------------------------------------
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

comment on function public.report_content is
  'The ONE member report path (0288). False unless the reporter can see the target; never your own; one per reporter per target. Member photos hide at 3 open reports.';

-- ---- fold in 0286's photo reports ---------------------------------------------
insert into public.content_reports (target_type, target_id, target_owner_id, reporter_id, reason, note, created_at)
select 'member_photo', r.photo_id::text, m.owner_id, r.reporter_id,
       case when r.reason in ('harassment', 'personal_info', 'nudity', 'violence', 'spam') then r.reason else 'other' end,
       r.note, r.created_at
  from public.member_photo_reports r
  join public.member_photos m on m.id = r.photo_id
on conflict (target_type, target_id, reporter_id) do nothing;

create or replace function public.report_member_photo(p_photo uuid, p_reason text, p_note text default null)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select public.report_content('member_photo', p_photo::text, p_reason, p_note);
$$;

revoke all on function public.report_member_photo(uuid, text, text) from public, anon;
grant execute on function public.report_member_photo(uuid, text, text) to authenticated, service_role;

drop table if exists public.member_photo_reports;

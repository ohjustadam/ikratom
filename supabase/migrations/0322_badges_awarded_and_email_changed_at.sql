-- 0322_badges_awarded_and_email_changed_at.sql
--
-- PJ, 2026-11-13/14. Two member-facing fixes:
--
-- 1. Mission patches were never awarded. recomputeBadgesForUser() existed in
--    src/modules/badges/award.ts, but nothing called it: on 2026-11-16 there
--    were 0 user_badges rows for 2,644 campaign_actions. award_badges_for()
--    evaluates the same conditions in SQL, and statement-level triggers on
--    campaign_actions, forum_threads and forum_posts run it for every member
--    in the insert, so every send path (one-click queue, legacy, compose,
--    waves) and every post counts. A new patch drops a bell notification.
--    The backfill below awards existing members' patches SILENTLY (no bell).
--    The "bipartisan_outreach" patch has no rule yet, as before.
--
-- 2. The 7-day resend lock blocked letters to officials whose bounced address
--    was later corrected (PJ's three MI House members, fixed 11-11/11-12).
--    legislators.email_changed_at records when an official's email last
--    changed; the app lets a member resend when it changed after their send.
--    Backfilled from the provenance lines the contact fixes left in
--    verified_sources_md, at the end of that day (Central), so a send made
--    earlier the same day counts as "before the fix".
--
-- Rollback:
--   drop trigger campaign_actions_award_badges on public.campaign_actions;
--   drop trigger forum_threads_award_badges on public.forum_threads;
--   drop trigger forum_posts_award_badges on public.forum_posts;
--   drop function public.award_badges_after_insert();
--   drop function public.award_badges_for(uuid, boolean);
--   drop trigger legislators_email_changed_at on public.legislators;
--   drop function public.legislators_stamp_email_change();
--   alter table public.legislators drop column email_changed_at;
--   (user_badges rows may stay; they are what members earned.)

-- ── 1. Badges ────────────────────────────────────────────────────────────────
create or replace function public.award_badges_for(p_user uuid, p_notify boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emails int := 0;
  v_calls int := 0;
  v_threads int := 0;
  v_replies int := 0;
  v_streak int := 0;
  v_created timestamptz;
  v_new int := 0;
begin
  select coalesce(longest_streak_days, 0), created_at
    into v_streak, v_created
    from public.profiles where id = p_user;
  if not found then return 0; end if;

  select count(*) filter (where method = 'call'),
         count(*) filter (where method is distinct from 'call')
    into v_calls, v_emails
    from public.campaign_actions where user_id = p_user;
  select count(*) into v_threads from public.forum_threads where author_id = p_user;
  select count(*) into v_replies from public.forum_posts where author_id = p_user;

  with wanted as (
    -- Names and emoji mirror src/modules/badges/catalog.ts (tests/badges-sql.test.ts holds them together).
    select v.badge_id, v.emoji, v.name
      from (values
        ('first_email',        '📨',     'First Email Sent', v_emails >= 1),
        ('first_call',         '📞',     'First Call Made',  v_calls >= 1),
        ('five_emails',        '🥉',     '5 emails',         v_emails >= 5),
        ('twenty_five_emails', '🥈',     '25 emails',        v_emails >= 25),
        ('hundred_emails',     '🥇',     '100 emails',       v_emails >= 100),
        ('first_thread',       '💬',     'First Thread',     v_threads >= 1),
        ('first_reply',        '↩️',     'First Reply',      v_replies >= 1),
        ('streak_7',           '🔥',     'Week-Long Streak', v_streak >= 7),
        ('streak_30',          '🔥🔥',   '30-Day Streak',    v_streak >= 30),
        ('streak_100',         '🔥🔥🔥', '100-Day Streak',   v_streak >= 100),
        ('early_adopter',      '🌱',     'Early Adopter',    v_created < timestamptz '2026-05-01 00:00:00+00')
      ) as v(badge_id, emoji, name, ok)
     where v.ok
  ),
  ins as (
    insert into public.user_badges (user_id, badge_id)
    select p_user, w.badge_id from wanted w
    on conflict (user_id, badge_id) do nothing
    returning badge_id
  ),
  bell as (
    insert into public.notifications (user_id, kind, title, body, link)
    select p_user, 'badge_earned', 'You earned: ' || w.emoji || ' ' || w.name,
           'See all your mission patches.', '/account/badges'
      from ins join wanted w using (badge_id)
     where p_notify
    returning 1
  )
  select count(*) into v_new from ins;

  return v_new;
end;
$$;

create or replace function public.award_badges_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if tg_table_name = 'campaign_actions' then
    for r in select distinct user_id as uid from new_rows where user_id is not null loop
      perform public.award_badges_for(r.uid, true);
    end loop;
  else
    for r in select distinct author_id as uid from new_rows where author_id is not null loop
      perform public.award_badges_for(r.uid, true);
    end loop;
  end if;
  return null;
exception when others then
  return null; -- a patch bug must never block a letter or a post
end;
$$;

drop trigger if exists campaign_actions_award_badges on public.campaign_actions;
create trigger campaign_actions_award_badges
  after insert on public.campaign_actions
  referencing new table as new_rows
  for each statement execute function public.award_badges_after_insert();

drop trigger if exists forum_threads_award_badges on public.forum_threads;
create trigger forum_threads_award_badges
  after insert on public.forum_threads
  referencing new table as new_rows
  for each statement execute function public.award_badges_after_insert();

drop trigger if exists forum_posts_award_badges on public.forum_posts;
create trigger forum_posts_award_badges
  after insert on public.forum_posts
  referencing new table as new_rows
  for each statement execute function public.award_badges_after_insert();

-- Server-side only: never an RPC endpoint (it awards for an ARBITRARY user).
revoke execute on function public.award_badges_for(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.award_badges_after_insert() from public, anon, authenticated;

-- Silent backfill: what existing members already earned, with no bell.
select public.award_badges_for(p.id, false)
  from public.profiles p
 where exists (select 1 from public.campaign_actions a where a.user_id = p.id)
    or exists (select 1 from public.forum_threads t where t.author_id = p.id)
    or exists (select 1 from public.forum_posts f where f.author_id = p.id)
    or coalesce(p.longest_streak_days, 0) >= 7
    or p.created_at < timestamptz '2026-05-01 00:00:00+00';

-- ── 2. When an official's email last changed ─────────────────────────────────
alter table public.legislators add column if not exists email_changed_at timestamptz;

create or replace function public.legislators_stamp_email_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.email is distinct from old.email and old.email is not null then
    new.email_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists legislators_email_changed_at on public.legislators;
create trigger legislators_email_changed_at
  before update of email on public.legislators
  for each row execute function public.legislators_stamp_email_change();

update public.legislators l
   set email_changed_at = s.changed_at
  from (
    select id,
           max(((coalesce(m[1], m[2]))::date + 1)::timestamp at time zone 'America/Chicago') - interval '1 second' as changed_at
      from public.legislators,
           regexp_matches(verified_sources_md,
             'Contact refreshed (\d{4}-\d{2}-\d{2})[^\n]*?email "|Email corrected (\d{4}-\d{2}-\d{2})', 'g') as m
     where verified_sources_md is not null
     group by id
  ) s
 where l.id = s.id
   and l.email_changed_at is null;

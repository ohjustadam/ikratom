-- 0271: at most ONE "local officials added" notification per person per day.
--
-- 2026-10-09 the owner got 73 pushed notifications in three days, one per
-- place: the nightly hot-zone seeder files coverage requests under the owner's
-- account, so the owner is the "requester" of every place it fills, and
-- notify_locality_residents sent a separate notification for each.
--
-- Now, per person and per Eastern-time day: the first place still creates the
-- notification (and is pushed once, by the hourly fan-out); every later place
-- that day is folded into that same row ("Local officials added for 12 places
-- today: …"), with no new push. If it was already read it becomes unread
-- again, so the update is seen in the app.
--
-- "Never twice for the same place" used to be inferred from notification
-- titles; merged titles no longer name every place, so it moves to
-- reps_added_log, backfilled from every reps_added notification already sent.
--
-- Rollback: re-run the function body from 0193_notify_locality_residents.sql
-- and drop table public.reps_added_log.

create table if not exists public.reps_added_log (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  state        text not null,
  locality_key text not null,  -- lower(locality without ", ST"), the match key
  locality     text not null,  -- display form, e.g. "Wise County, TX"
  notified_at  timestamptz not null default now(),
  primary key (user_id, state, locality_key)
);
create index if not exists reps_added_log_user_time on public.reps_added_log (user_id, notified_at desc);
-- Only SECURITY DEFINER functions touch it: RLS on, no policies, no grants.
alter table public.reps_added_log enable row level security;
revoke all on public.reps_added_log from public, anon, authenticated;
grant all on public.reps_added_log to service_role;

-- Backfill from notifications already sent (current " for X, ST are" and
-- legacy " in X, ST are" titles), so nobody is told twice about a place.
insert into public.reps_added_log (user_id, state, locality_key, locality, notified_at)
select distinct on (n.user_id, upper(m[2]), lower(trim(m[1])))
       n.user_id, upper(m[2]), lower(trim(m[1])), trim(m[1]) || ', ' || upper(m[2]), n.created_at
from public.notifications n
cross join lateral regexp_match(n.title, '(?: for | in )(.+?),\s*([A-Za-z]{2}) are') as m
where n.kind = 'reps_added'
  and m is not null
  and exists (select 1 from public.profiles p where p.id = n.user_id)
order by n.user_id, upper(m[2]), lower(trim(m[1])), n.created_at
on conflict do nothing;

create or replace function public.notify_locality_residents(p_state text, p_locality text, p_official_names text[] default null::text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- profiles.city/county are Census-bare ("Midwest City"), locality keys
  -- carry the ", ST" suffix — strip it once for matching.
  v_bare     text := trim(regexp_replace(p_locality, ',\s*[A-Za-z]{2}\s*$', ''));
  v_key      text := lower(trim(regexp_replace(p_locality, ',\s*[A-Za-z]{2}\s*$', '')));
  v_today    date := (now() at time zone 'America/New_York')::date;
  v_title    text;
  v_body     text;
  v_names    text;
  v_total    int;
  v_count    int := 0;
  v_new      int;
  v_existing uuid;
  v_places   int;
  v_list     text;
  r          record;
begin
  -- Serialize concurrent fulfills of the same locality (admin click racing
  -- the batch) so the dedup can't double-insert.
  perform pg_advisory_xact_lock(hashtext('notify_locality:' || p_state || ':' || v_key));

  -- The single-place message (used when it is the person's first of the day).
  v_title := 'Your local officials for ' || p_locality || ' are in your War Room';
  v_total := coalesce(array_length(p_official_names, 1), 0);
  if v_total > 0 then
    select string_agg(n, ', ' order by ord) into v_names
    from unnest(p_official_names[1:3]) with ordinality as t(n, ord);
    if v_total > 3 then
      v_names := v_names || ' and ' || (v_total - 3)::text || ' more';
    end if;
    v_body := v_names || ' now appear on your dashboard — names, emails, one-click contact. '
           || 'Also in your War Room for ' || v_bare || ': the law around you, pending measures, and council meeting dates.';
  else
    v_body := 'Your officials for ' || p_locality || ' are loaded — names, emails, one-click contact. '
           || 'Also in your War Room: the law around you, pending measures, and council meeting dates.';
  end if;

  for r in
    select distinct user_id from (
      -- Requesters (case-insensitive: normalizeLocality title-cases while
      -- profiles hold Census casing)...
      select user_id from local_rep_requests
       where state = p_state and status = 'fulfilled'
         and lower(trim(regexp_replace(locality, ',\s*[A-Za-z]{2}\s*$', ''))) = v_key
      union all
      -- ...and residents of the place.
      select id from profiles
       where state = p_state and (lower(trim(city)) = v_key or lower(trim(county)) = v_key)
    ) t
    where user_id is not null
  loop
    -- Never twice for the same place.
    insert into reps_added_log (user_id, state, locality_key, locality)
    values (r.user_id, p_state, v_key, p_locality)
    on conflict do nothing;
    get diagnostics v_new = row_count;
    if v_new = 0 then continue; end if;

    -- One notification per person per day: fold later places into today's row.
    perform pg_advisory_xact_lock(hashtext('notify_reps_day:' || r.user_id::text));
    select id into v_existing from notifications
     where user_id = r.user_id and kind = 'reps_added'
       and (created_at at time zone 'America/New_York')::date = v_today
     order by created_at desc
     limit 1;

    if v_existing is null then
      insert into notifications (user_id, kind, title, body, link)
      values (r.user_id, 'reps_added', v_title, v_body, '/dashboard');
    else
      select count(*), string_agg(locality, ', ' order by notified_at) filter (where rn <= 3)
        into v_places, v_list
      from (
        select locality, notified_at, row_number() over (order by notified_at) as rn
        from reps_added_log
        where user_id = r.user_id
          and (notified_at at time zone 'America/New_York')::date = v_today
      ) d;
      update notifications
         set title   = 'Local officials added for ' || v_places || ' places today',
             body    = v_list
                       || case when v_places > 3 then ' and ' || (v_places - 3) || ' more' else '' end
                       || ' now have officials on file — names, emails, one-click contact. See them in your War Room.',
             read_at = null
       where id = v_existing;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

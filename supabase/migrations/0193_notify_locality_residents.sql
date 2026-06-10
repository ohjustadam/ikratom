-- 0193_notify_locality_residents.sql — ONE shared notify path for local-rep
-- fulfillment (PR-C).
--
-- Background: only the admin accept path notified anyone (and it notified
-- residents WITHOUT dedup and WITHOUT requesters); the batch + cron
-- auto-fulfill paths notified NOBODY — 17 requesters were backfilled by hand
-- on 2026-06-09. This RPC is the permanent fix: every fulfill path (admin TS,
-- cron TS, box .mjs) calls the same SQL, so the notify rule can never drift
-- between runtimes again.
--
-- Audience  = requesters (local_rep_requests, fulfilled, same locality)
--           ∪ residents (profiles.city/county match, same state).
-- Dedup     = per USER per LOCALITY, all-time: skip anyone whose existing
--             reps_added notification names this locality in its title.
-- Delivery  = a notifications row only; the hourly push fan-out delivers with
--             its own DND / quiet-hours / coalesce / rate-cap safety.
--
-- Rollback: drop function public.notify_locality_residents(text, text, text[]);

create or replace function public.notify_locality_residents(
  p_state text,
  p_locality text,                  -- canonical "City, ST" / "Some County, ST"
  p_official_names text[] default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  -- profiles.city/county are Census-bare ("Midwest City"), locality keys
  -- carry the ", ST" suffix — strip it once for matching.
  v_bare  text := trim(regexp_replace(p_locality, ',\s*[A-Za-z]{2}\s*$', ''));
  v_title text;
  v_body  text;
  v_names text;
  v_total int;
  v_count int := 0;
begin
  v_title := 'Your local officials for ' || p_locality || ' are in your War Room';

  v_total := coalesce(array_length(p_official_names, 1), 0);
  if v_total > 0 then
    select string_agg(n, ', ') into v_names from unnest(p_official_names[1:3]) as n;
    if v_total > 3 then
      v_names := v_names || ' and ' || (v_total - 3)::text || ' more';
    end if;
    v_body := v_names || ' now appear on your dashboard — names, emails, one-click contact. '
           || 'Also in your War Room for ' || v_bare || ': the law around you, pending measures, and council meeting dates.';
  else
    v_body := 'Your officials for ' || p_locality || ' are loaded — names, emails, one-click contact. '
           || 'Also in your War Room: the law around you, pending measures, and council meeting dates.';
  end if;

  with requesters as (
    select user_id
    from local_rep_requests
    where state = p_state
      and status = 'fulfilled'
      and lower(trim(regexp_replace(locality, ',\s*[A-Za-z]{2}\s*$', ''))) = lower(v_bare)
  ),
  residents as (
    select id as user_id
    from profiles
    where state = p_state
      and (city = v_bare or county = v_bare)
  ),
  targets as (
    select distinct user_id
    from (select user_id from requesters union all select user_id from residents) t
    where user_id is not null
  ),
  fresh as (
    select tg.user_id
    from targets tg
    where not exists (
      select 1 from notifications n
      where n.user_id = tg.user_id
        and n.kind = 'reps_added'
        and n.title ilike '%' || p_locality || '%'
    )
  )
  insert into notifications (user_id, kind, title, body, link)
  select user_id, 'reps_added', v_title, v_body, '/dashboard'
  from fresh;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.notify_locality_residents(text, text, text[]) is
  'Shared reps-added notify for ALL local-rep fulfill paths (admin/cron/box). Requesters ∪ residents, deduped per user+locality; push rides the hourly fan-out.';

-- Service contexts only — never user-callable.
revoke execute on function public.notify_locality_residents(text, text, text[]) from public;
revoke execute on function public.notify_locality_residents(text, text, text[]) from anon;
revoke execute on function public.notify_locality_residents(text, text, text[]) from authenticated;
grant execute on function public.notify_locality_residents(text, text, text[]) to service_role;

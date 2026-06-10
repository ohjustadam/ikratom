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
  -- Serialize concurrent fulfills of the same locality (admin click racing
  -- the hourly cron) so the NOT EXISTS dedup can't double-insert.
  perform pg_advisory_xact_lock(hashtext('notify_locality:' || p_state || ':' || lower(v_bare)));

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

  with requesters as (
    select user_id
    from local_rep_requests
    where state = p_state
      and status = 'fulfilled'
      and lower(trim(regexp_replace(locality, ',\s*[A-Za-z]{2}\s*$', ''))) = lower(v_bare)
  ),
  residents as (
    -- Case-insensitive, matching the requesters arm: normalizeLocality
    -- title-cases ("DeSoto" -> "Desoto") while profiles hold Census casing —
    -- an exact match would be a silent per-locality dead zone.
    select id as user_id
    from profiles
    where state = p_state
      and (lower(trim(city)) = lower(v_bare) or lower(trim(county)) = lower(v_bare))
  ),
  targets as (
    select distinct user_id
    from (select user_id from requesters union all select user_id from residents) t
    where user_id is not null
  ),
  fresh as (
    -- Per-user-per-locality dedup, anchored on " for <locality> are" /
    -- " in <locality> are" (current + legacy title formats) so a prior
    -- "North Charleston, SC" notification can't suppress "Charleston, SC".
    select tg.user_id
    from targets tg
    where not exists (
      select 1 from notifications n
      where n.user_id = tg.user_id
        and n.kind = 'reps_added'
        and (n.title ilike '% for ' || p_locality || ' are%'
          or n.title ilike '% in ' || p_locality || ' are%')
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

-- Adjacent pre-existing hole (caught in the PR-C review): the 0050 fulfill
-- RPC was executable by ANY authenticated user. Its only caller uses the
-- service-role client — lock it down the same way.
revoke execute on function public.fulfill_local_rep_requests(text, text) from public;
revoke execute on function public.fulfill_local_rep_requests(text, text) from anon;
revoke execute on function public.fulfill_local_rep_requests(text, text) from authenticated;
grant execute on function public.fulfill_local_rep_requests(text, text) to service_role;

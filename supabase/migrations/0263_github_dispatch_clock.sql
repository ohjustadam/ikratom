-- ============================================================
-- 0263_github_dispatch_clock
--
-- WHY (2026-10-06). GitHub runs scheduled workflows late or not at all: the
-- "every 2 hours" cron-hourly ran 3 times in 24h (01:04, 08:28, 16:26 UTC) and
-- cron-daily was created 6.5-9h after its 10:17 slot. So "instant" hearing
-- alerts, push fan-out and news intake really ran about every 8 hours, and the
-- morning email went out at noon.
--
-- A workflow_dispatch event is not subject to those schedule delays. Supabase's
-- pg_cron is a reliable clock on the free plan, and pg_net can call GitHub's
-- dispatch API, so the database becomes the clock:
--   pg_cron --(on time)--> public.dispatch_github_workflow() --pg_net--> GitHub
-- The workflows keep their own `schedule:` as a FALLBACK; a late scheduled run
-- that finds an on-time dispatched run cancels itself (the `clock` job in
-- cron-hourly.yml / cron-daily.yml). If this clock dies (token expired, project
-- restricted), nothing dispatches and the fallback silently takes over.
--
-- The GitHub token lives in Supabase Vault as 'github_dispatch_token', stored by
-- the owner with scripts/store-dispatch-token.mjs (a fine-grained token limited
-- to Actions read/write on this one repo). Until it is stored, the function is
-- a no-op and GitHub's schedule stays in charge.
--
-- Health: pg_net is asynchronous, so each call reports the PREVIOUS dispatch's
-- HTTP result as scraper_runs source 'dispatch_clock' (204 = success). The
-- staleness pager watches that source like any cron.
--
-- Rollback:
--   select cron.unschedule('ikratom-dispatch-hourly');
--   select cron.unschedule('ikratom-dispatch-daily');
--   drop function if exists public.dispatch_github_workflow(text);
--   drop table if exists public.dispatch_clock_state;
-- ============================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
grant usage on schema cron to postgres;

-- Last request id per workflow, so the next call can read its response.
create table if not exists public.dispatch_clock_state (
  workflow        text primary key,
  last_request_id bigint,
  last_at         timestamptz not null default now()
);
alter table public.dispatch_clock_state enable row level security;
-- No policies: only the definer function (and service role) touch it.

create or replace function public.dispatch_github_workflow(p_workflow text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok         text;
  prev_id     bigint;
  prev_status int;
  prev_err    text;
  req         bigint;
begin
  if p_workflow !~ '^[a-z0-9-]+\.yml$' then
    raise exception 'dispatch_github_workflow: bad workflow name %', p_workflow;
  end if;

  select ds.decrypted_secret into tok
    from vault.decrypted_secrets ds where ds.name = 'github_dispatch_token' limit 1;
  if tok is null or btrim(tok) = '' then
    return null;  -- not configured yet: GitHub's own schedule stays in charge
  end if;
  -- A secret pasted through a Windows shell can carry a byte-order mark.
  tok := btrim(replace(tok, chr(65279), ''));

  -- Report how the previous dispatch went.
  select s.last_request_id into prev_id from public.dispatch_clock_state s where s.workflow = p_workflow;
  if prev_id is not null then
    select r.status_code, r.error_msg into prev_status, prev_err
      from net._http_response r where r.id = prev_id;
    insert into public.scraper_runs (source, started_at, finished_at, status, rows_updated, notes)
    values ('dispatch_clock', now(), now(),
            case when prev_status = 204 then 'success' else 'error' end, 0,
            left(format('%s: previous dispatch -> %s %s', p_workflow,
                        coalesce(prev_status::text, 'no response yet'), coalesce(prev_err, '')), 300));
  end if;

  select net.http_post(
    url     := 'https://api.github.com/repos/ohjustadam/ikratom/actions/workflows/' || p_workflow || '/dispatches',
    body    := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'ikratom-pg-cron-clock',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  ) into req;

  insert into public.dispatch_clock_state (workflow, last_request_id, last_at)
  values (p_workflow, req, now())
  on conflict (workflow) do update set last_request_id = excluded.last_request_id, last_at = excluded.last_at;
  return req;
end;
$$;

revoke all on function public.dispatch_github_workflow(text) from public, anon, authenticated;

-- Same slots as the workflows' own schedules (UTC), a few minutes past the hour
-- so they never compete with GitHub's top-of-hour rush.
select cron.schedule('ikratom-dispatch-hourly', '3 */2 * * *', $$select public.dispatch_github_workflow('cron-hourly.yml')$$);
select cron.schedule('ikratom-dispatch-daily', '17 10 * * *', $$select public.dispatch_github_workflow('cron-daily.yml')$$);

-- 0300_prune_retention.sql
--
-- Standing retention for two tables the B20 prune cut back on 2026-10-27/28
-- (owner approved the nightly job, 2026-10-28). Without it they grow back:
--   * state_briefings: every regeneration inserts a new row and deactivates
--     the old one, ~16 rows/day. Keep the active row plus the 3 newest
--     inactive rows per state (the history /admin/intel-health compares).
--   * scraper_runs: ~580 telemetry rows/day. Keep 90 days, and always keep
--     each source's newest row, so check-cron-staleness.mjs and the
--     scraper_runs_latest view still see when a long-dead source last ran.
--
-- A hand-written manual_addendum_md is never lost: an inactive row is pruned
-- only when its addendum is empty or identical to the state's active row
-- (generate-state-briefing.mjs carries the addendum forward on regeneration).
--
-- Each call deletes at most p_limit rows per table, so a backlog drains over
-- a few nights instead of in one long lock. Plain DELETE frees space for
-- reuse; the tables stay flat, which is the point (only VACUUM FULL shrinks
-- the file, and that is not needed at steady state).
--
-- Called nightly by scripts/prune-retention.mjs (cron-nightly-cloud.yml).
--
-- Rollback:
--   drop function if exists public.prune_retention(boolean, integer);

create or replace function public.prune_retention(p_apply boolean default false, p_limit integer default 5000)
returns table (briefings integer, scraper_runs integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b integer;
  s integer;
begin
  create temp table _prune_briefings on commit drop as
    select x.id from (
      select sb.id, sb.state, sb.manual_addendum_md,
             row_number() over (partition by sb.state order by sb.generated_at desc) rn
      from public.state_briefings sb
      where not sb.is_active
    ) x
    left join public.state_briefings a on a.state = x.state and a.is_active
    where x.rn > 3
      and (x.manual_addendum_md is null or x.manual_addendum_md = a.manual_addendum_md)
    limit p_limit;

  create temp table _prune_runs on commit drop as
    select r.id from public.scraper_runs r
    where r.started_at < now() - interval '90 days'
      and r.id not in (select distinct on (source) id from public.scraper_runs order by source, started_at desc)
    limit p_limit;

  if p_apply then
    delete from public.state_briefings where id in (select id from _prune_briefings);
    get diagnostics b = row_count;
    delete from public.scraper_runs where id in (select id from _prune_runs);
    get diagnostics s = row_count;
  else
    select count(*) into b from _prune_briefings;
    select count(*) into s from _prune_runs;
  end if;

  return query select b, s;
end;
$$;

revoke all on function public.prune_retention(boolean, integer) from public, anon, authenticated;
grant execute on function public.prune_retention(boolean, integer) to service_role;

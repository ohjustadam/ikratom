-- ============================================================
-- 0095_bop_stale_source_alert
--
-- If a BoP cron job silently fails (Vercel function timed out, GH
-- Actions runner outage, Cloudflare blocking us, etc.) we'd have no
-- alarm. This adds a daily sweep that flags any enabled source whose
-- last_scraped_at is older than 48 hours and notifies admins.
--
-- Threshold of 48h (not 24h) because:
-- - Vercel cron runs at 12:00 UTC; GH Actions at 10:00 UTC
-- - If one path skips a day (e.g. GH Actions runner outage), the other
--   still keeps the timestamp fresh
-- - 48h means TWO consecutive missed crons before we alert — strong
--   signal that something's actually broken, not a transient hiccup
-- ============================================================

-- Postgres function: returns enabled sources stale >48h.
-- Used by the admin /admin/bop-monitor surface AND the daily sweep.
create or replace function public.get_stale_bop_sources(p_hours int default 48)
returns table (
  id uuid,
  state text,
  board_name text,
  surface text,
  adapter text,
  agenda_url text,
  last_scraped_at timestamptz,
  last_status text,
  last_error text,
  hours_since_scrape numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    id, state, board_name, surface, adapter, agenda_url,
    last_scraped_at, last_status, last_error,
    extract(epoch from (now() - coalesce(last_scraped_at, '1970-01-01'::timestamptz))) / 3600
      as hours_since_scrape
  from public.bop_sources
  where enabled = true
    and (last_scraped_at is null or last_scraped_at < now() - (p_hours || ' hours')::interval)
  order by last_scraped_at asc nulls first;
$$;

grant execute on function public.get_stale_bop_sources(int) to authenticated;

-- One-shot sweep function: creates a policy_alert when stale sources
-- exist and notifies all admins. Called by the daily cron (added in
-- the same PR's daily-sync route patch).
--
-- Returns the number of stale sources found.
create or replace function public.bop_stale_source_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stale_count int;
  v_state_list text;
  v_already_emitted boolean;
begin
  select count(*),
         string_agg(distinct state, ', ' order by state)
    into v_stale_count, v_state_list
    from public.bop_sources
   where enabled = true
     and (last_scraped_at is null or last_scraped_at < now() - interval '48 hours');

  if v_stale_count = 0 then
    return 0;
  end if;

  -- Don't re-fire the same alert every day. If we already created a
  -- stale-source alert within the last 24 hours, skip.
  select exists(
    select 1 from public.policy_alerts
     where kind = 'bop_scraper_stale'
       and created_at > now() - interval '24 hours'
       and moderation_status = 'approved'
  ) into v_already_emitted;

  if v_already_emitted then
    return v_stale_count;
  end if;

  -- Emit a single rolled-up policy_alert. Visible on /pulse + dashboard
  -- (severity='alert' makes it appear in the live war-room feed).
  insert into public.policy_alerts (kind, severity, title, body, locality, moderation_status, action_required)
  values (
    'bop_scraper_stale',
    'alert',
    '⚠ BoP scraper stale: ' || v_stale_count || ' source(s) haven''t been scraped in 48h',
    'States affected: ' || coalesce(v_state_list, '(unknown)') || E'\n\n'
      || 'This means either a cron job failed or those state .gov sites changed their structure. '
      || 'Visit /admin/bop-monitor and check last_status/last_error on each affected row. '
      || 'Use the ✏ pencil to fix the URL inline; click Scrape now to retest.',
    'ALL',
    'approved',
    true
  );

  -- Also push notification to every admin so they don't miss it.
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id,
         'bop_scraper_stale',
         '⚠ BoP scraper has ' || v_stale_count || ' stale source(s)',
         'States: ' || coalesce(v_state_list, '(unknown)'),
         '/admin/bop-monitor'
    from public.profiles p
   where p.is_admin = true or p.is_owner = true
  on conflict do nothing;

  return v_stale_count;
end;
$$;

grant execute on function public.bop_stale_source_sweep() to authenticated;

comment on function public.get_stale_bop_sources is
  'Returns enabled BoP sources whose last successful scrape is older than p_hours (default 48). Used by /admin/bop-monitor + the daily cron sweep.';
comment on function public.bop_stale_source_sweep is
  'Daily sweep: emits a rolled-up policy_alert + admin notifications when enabled sources are stale >48h. Idempotent — skips if same alert created in last 24h.';

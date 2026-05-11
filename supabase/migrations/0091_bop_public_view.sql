-- ============================================================
-- 0091_bop_public_view
--
-- The /bop-watch advocate-facing surface needs to read bop_sources +
-- bop_findings without granting public RLS on those tables (admins
-- still own them — they hold un-triaged + admin-only fields like
-- reviewer notes).
--
-- Solution: SECURITY DEFINER RPCs that expose only the safe columns
-- to anyone, with finder/reviewer fields stripped. Admin RLS on the
-- underlying tables is unchanged.
--
-- The two views:
--   get_public_bop_sources()  — every enabled source + last_status
--                               (so we can show "we monitor 51 state
--                               BoPs daily, here's last scrape time")
--   get_public_bop_findings() — only kratom_direct + kratom_adjacent
--                               findings from the last 60 days, NOT
--                               admin-flagged-as-unrelated
-- ============================================================

-- Sources: public-safe summary, no admin notes
drop function if exists public.get_public_bop_sources();
create or replace function public.get_public_bop_sources()
returns table (
  state text,
  board_name text,
  surface text,
  kind text,
  agenda_url text,
  enabled boolean,
  last_scraped_at timestamptz,
  last_status text,
  last_finding_count int
)
language sql
security definer
set search_path = public
stable
as $$
  select state, board_name, surface, kind, agenda_url, enabled,
         last_scraped_at, last_status, last_finding_count
    from public.bop_sources
   order by state, board_name;
$$;

grant execute on function public.get_public_bop_sources() to authenticated, anon;

-- Findings: only the ones that classified or reviewed as kratom-
-- related, last 60 days. Strip admin reviewer + raw fields.
drop function if exists public.get_public_bop_findings(int);
create or replace function public.get_public_bop_findings(p_days int default 60)
returns table (
  id uuid,
  state text,
  title text,
  snippet text,
  url text,
  meeting_date date,
  relevance text,
  severity text,
  alert_emitted_at timestamptz,
  found_at timestamptz,
  board_name text,
  surface text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.id,
    f.state,
    f.title,
    f.snippet,
    f.url,
    f.meeting_date,
    coalesce(f.reviewed_relevance, f.classified_relevance) as relevance,
    coalesce(f.reviewed_severity, f.classified_severity) as severity,
    f.alert_emitted_at,
    f.found_at,
    s.board_name,
    s.surface
  from public.bop_findings f
  join public.bop_sources s on s.id = f.source_id
  where f.found_at > now() - (p_days || ' days')::interval
    and coalesce(f.reviewed_relevance, f.classified_relevance)
        in ('kratom_direct', 'kratom_adjacent')
    -- Hide findings the admin reviewed and marked unrelated.
    and (f.reviewed_relevance is null or f.reviewed_relevance <> 'unrelated')
  order by f.found_at desc;
$$;

grant execute on function public.get_public_bop_findings(int) to authenticated, anon;

comment on function public.get_public_bop_findings is
  'Public read of BoP findings classified or reviewed as kratom-related. Strips admin-only fields. Used by /bop-watch.';
comment on function public.get_public_bop_sources is
  'Public read of BoP source surfaces + last scrape status. Used by /bop-watch to show coverage.';

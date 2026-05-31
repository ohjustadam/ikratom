-- 0164_news_alert_local_targeting.sql
--
-- Make news-derived alerts actionable against the RIGHT local officials.
--
-- Problem: pick_targets_for_alert() derives the city by regex-matching
-- the alert TITLE for a "City, ST" prefix. That works for bill-derived
-- alerts (whose titles we format that way) but NOT for news-derived
-- alerts — their titles are news headlines ("Nassau County police shut
-- down trio of smoke shops…"). So local targeting was skipped and the
-- auto-campaign got no local officials, leaving the alert effectively
-- un-actionable (or stuck on the wrong state-level fallback).
--
-- Fix:
--   1. Add policy_alerts.specific_locality — the precise "City, ST" /
--      "County, ST" string, populated by scripts/extract-news-officials.mjs
--      (and going forward by classify-news-policy.mjs).
--   2. Add policy_alerts.officials_extracted_at — processing marker so
--      the hourly extractor doesn't re-run AI on the same alert.
--   3. Patch pick_targets_for_alert() to derive the city from
--      specific_locality FIRST, falling back to the title regex. This is
--      purely additive: alerts without specific_locality behave exactly
--      as before.
--
-- Rollback: drop the two columns; re-run 0073's function body.

ALTER TABLE public.policy_alerts
  ADD COLUMN IF NOT EXISTS specific_locality text,
  ADD COLUMN IF NOT EXISTS officials_extracted_at timestamptz;

COMMENT ON COLUMN public.policy_alerts.specific_locality IS
  'Precise "City, ST" or "County, ST" the alert concerns. Drives local official targeting when the title is a news headline rather than a "City, ST" prefix.';
COMMENT ON COLUMN public.policy_alerts.officials_extracted_at IS
  'Set by scripts/extract-news-officials.mjs once the alert has been processed for locality extraction + official seeding. NULL = not yet processed.';

-- Patched targeting function. Identical to 0073 except v_city_name is
-- now derived from specific_locality first, and v_is_local also trips
-- when specific_locality is present.
create or replace function public.pick_targets_for_alert(p_alert public.policy_alerts)
returns table (
  target_legislator_ids uuid[],
  target_roles text[],
  target_locality text,
  tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city_name text;
  v_ids uuid[];
  v_is_local boolean;
  v_title_lc text;
begin
  v_title_lc := lower(coalesce(p_alert.title, ''));

  -- Prefer the structured specific_locality ("City, ST" / "County, ST").
  -- Strip the trailing ", ST" so we match the legislators.locality city
  -- portion. Fall back to the title-prefix regex (bill-derived alerts).
  if p_alert.specific_locality is not null
     and length(trim(p_alert.specific_locality)) > 0 then
    v_city_name := trim(split_part(p_alert.specific_locality, ',', 1));
  else
    v_city_name := substring(p_alert.title from '^([A-Z][a-zA-Z\s\.]+),\s+([A-Z]{2})');
  end if;

  v_is_local := (
    p_alert.specific_locality is not null
    or p_alert.title ~ '^[A-Z][a-zA-Z\s\.]+,\s+[A-Z]{2}'
    or v_title_lc ~ '\m(city ordinance|city council|alderman|alderwoman|alderperson|municipal|county council|county commissioner|county judge|board of selectmen)\M'
  );

  -- Tier 1: city/county officials for the locality
  if p_alert.locality ~ '^[A-Z]{2}$' then
    if v_city_name is not null and length(trim(v_city_name)) > 0 then
      select array_agg(id) into v_ids
      from public.legislators
      where state = p_alert.locality
        and locality ilike '%' || trim(v_city_name) || '%'
        and role in ('city_council', 'mayor', 'county_executive', 'county_commissioner')
        and active = true;
      if v_ids is not null and array_length(v_ids, 1) > 0 then
        return query select v_ids,
                            array['city_council','mayor','county_executive','county_commissioner']::text[],
                            trim(v_city_name),
                            'local'::text;
        return;
      end if;
    end if;
  end if;

  -- Tier 2: BoP hearing — empty target_ids; campaign pulls from bop_boards
  if p_alert.kind = 'bop_hearing' and p_alert.bop_board_id is not null then
    return query select array[]::uuid[],
                        array[]::text[],
                        null::text,
                        'bop'::text;
    return;
  end if;

  -- Local-but-not-yet-seeded: empty targets, pending. The retarget hook
  -- fills them once local officials are seeded.
  if v_is_local then
    return query select array[]::uuid[],
                        array[]::text[],
                        v_city_name,
                        'local_pending'::text;
    return;
  end if;

  -- Tier 3: state legislators (legitimate fallback for state-level alerts)
  if p_alert.locality ~ '^[A-Z]{2}$' then
    select array_agg(id) into v_ids
    from (
      select id from public.legislators
      where state = p_alert.locality
        and role in ('state_senate', 'state_house')
        and active = true
      limit 200
    ) s;
    return query select coalesce(v_ids, array[]::uuid[]),
                        array['state_senate','state_house']::text[],
                        null::text,
                        'state'::text;
    return;
  end if;

  -- Tier 4: federal (US Senate + US House) for ALL/FED locality
  select array_agg(id) into v_ids
  from (
    select id from public.legislators
    where role in ('us_senate', 'us_house')
      and active = true
    limit 600
  ) s;
  return query select coalesce(v_ids, array[]::uuid[]),
                      array['us_senate','us_house']::text[],
                      null::text,
                      'federal'::text;
end;
$$;

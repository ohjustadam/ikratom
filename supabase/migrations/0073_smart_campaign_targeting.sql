-- ============================================================
-- 0073_smart_campaign_targeting
--
-- Two fixes for the issue where Marshall, IL — city ordinance was
-- targeting all 174 IL state legislators:
--
--   A) pick_targets_for_alert no longer falls back to all state legs
--      when the alert is clearly city/county-style and we don't yet
--      have local officials. It returns an empty target list instead
--      so the campaign lands in pending_review with no targets, and
--      the (B) retarget hook fixes it once seed-bill-officials runs.
--
--   B) retarget_auto_campaign(campaign_id) — re-runs targeting for an
--      existing auto-generated campaign. Called from the
--      seed-bill-officials script after new local officials are
--      added, so newly-seeded Marshall mayor + council automatically
--      replace the empty/wrong target list on the existing campaign.
--
-- Also expands Tier 1 to include county officials
-- (county_executive, county_commissioner) — previously only
-- city_council + mayor. County ordinances are common.
--
-- ROLLBACK: drop functions; campaigns table untouched.
-- ============================================================

-- ----------------------------------------
-- 1. Smarter targeting helper
-- ----------------------------------------
-- Returns empty target_ids for city/county-style alerts where no
-- local officials exist yet. Falls back to state legs ONLY for
-- alerts that look like state-level legislation (not city/county).
-- ----------------------------------------
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
  v_is_local boolean;     -- true if alert looks city/county-scoped
  v_title_lc text;
begin
  v_title_lc := lower(coalesce(p_alert.title, ''));
  -- "City, ST" prefix is the strongest signal of a local-scoped alert.
  -- Body keywords reinforce: "city ordinance", "city council", "county",
  -- "municipal", "alderman".
  v_is_local := (
    p_alert.title ~ '^[A-Z][a-zA-Z\s\.]+,\s+[A-Z]{2}'
    or v_title_lc ~ '\m(city ordinance|city council|alderman|alderwoman|alderperson|municipal|county council|county commissioner|county judge|board of selectmen)\M'
  );

  -- Tier 1: city/county officials for the locality (now includes county roles)
  if p_alert.locality ~ '^[A-Z]{2}$' then
    v_city_name := substring(p_alert.title from '^([A-Z][a-zA-Z\s\.]+),\s+([A-Z]{2})');
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

  -- IMPORTANT: if the alert is clearly city/county-scoped but Tier 1
  -- found no officials, DO NOT fall back to all state legs. State legs
  -- can't stop a city ordinance — their relevance is supporting state
  -- pre-emption legislation, which is a different ask. Return empty so
  -- the campaign lands in pending_review with no targets, then the
  -- retarget hook (called from seed-bill-officials) fills them in once
  -- local officials are seeded.
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

-- ----------------------------------------
-- 2. Retarget function — re-run targeting for an existing campaign
-- ----------------------------------------
-- Used by the post-seed-bill-officials hook to fix campaigns that
-- were created before local officials were seeded. Only touches
-- auto-generated, still-pending-review campaigns to avoid clobbering
-- admin-edited targets.
-- ----------------------------------------
create or replace function public.retarget_auto_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign record;
  v_alert public.policy_alerts;
  v_targets record;
  v_old_count int;
  v_new_count int;
begin
  -- Pull campaign + sanity-check it's an auto-generated one
  select id, slug, auto_generated, review_state, target_legislator_ids
    into v_campaign
    from public.campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'campaign_not_found');
  end if;
  if not v_campaign.auto_generated then
    return jsonb_build_object('ok', false, 'reason', 'not_auto_generated');
  end if;
  if v_campaign.review_state <> 'pending_review' then
    return jsonb_build_object('ok', false, 'reason', 'already_reviewed');
  end if;

  -- Find the alert that spawned this campaign (1:1 via campaign_id)
  select * into v_alert
    from public.policy_alerts
    where campaign_id = p_campaign_id
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_alert');
  end if;

  -- Re-run targeting
  select * into v_targets from public.pick_targets_for_alert(v_alert);
  v_old_count := coalesce(array_length(v_campaign.target_legislator_ids, 1), 0);
  v_new_count := coalesce(array_length(v_targets.target_legislator_ids, 1), 0);

  -- Only update if we got a non-empty result and it differs from current.
  -- Don't replace a populated target list with an empty one (would happen
  -- if someone edited the alert title to remove the city prefix, etc.).
  if v_new_count = 0 then
    return jsonb_build_object(
      'ok', false, 'reason', 'no_targets_found',
      'tier', v_targets.tier,
      'old_count', v_old_count
    );
  end if;

  update public.campaigns
     set target_legislator_ids = case
           when array_length(v_targets.target_legislator_ids, 1) > 0
           then v_targets.target_legislator_ids else null end,
         target_roles = case
           when array_length(v_targets.target_roles, 1) > 0
           then v_targets.target_roles else null end,
         target_locality = v_targets.target_locality
   where id = p_campaign_id;

  return jsonb_build_object(
    'ok', true,
    'tier', v_targets.tier,
    'old_count', v_old_count,
    'new_count', v_new_count,
    'locality', v_targets.target_locality
  );
end;
$$;

-- ----------------------------------------
-- 3. Bulk retarget for a locality — callable after seed-bill-officials
-- ----------------------------------------
-- Finds every still-pending auto-generated campaign whose alert is in
-- the given (state, locality) and retargets it. Returns the IDs +
-- per-campaign result for logging.
-- ----------------------------------------
create or replace function public.retarget_auto_campaigns_for_locality(
  p_state text,
  p_locality text
)
returns table (
  campaign_id uuid,
  result jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select c.id as campaign_id,
           public.retarget_auto_campaign(c.id) as result
      from public.campaigns c
     inner join public.policy_alerts a on a.campaign_id = c.id
     where c.auto_generated = true
       and c.review_state = 'pending_review'
       and a.locality = p_state
       and (
         -- Match on either the alert's title-derived city OR exact locality
         a.title ilike (p_locality || ',%')
         or a.title ilike (p_locality || ' —%')
         or a.title ilike (p_locality || '—%')
       );
end;
$$;

comment on function public.retarget_auto_campaign is
  'Re-runs targeting for an auto-generated, still-pending-review campaign. Used by seed-bill-officials post-hook to fix campaigns that landed before local officials existed.';

-- ============================================================
-- 0068_auto_campaign_trigger
--
-- Replace the hourly `auto-campaign-from-alert.mjs` cron step with a
-- real-time Postgres trigger. When a policy_alert lands (or is
-- approved by moderation) with action_required=true and no existing
-- campaign_id, we generate a solidarity campaign immediately —
-- removing the up-to-1-hour window where an actionable alert sits on
-- /pulse with no campaign to drive members toward.
--
-- This mirrors scripts/auto-campaign-from-alert.mjs exactly. The
-- script is kept for tactical recovery / backfill use; the trigger is
-- the canonical real-time path going forward. Both call into the same
-- targeting tier logic so behavior matches.
--
-- Templates live in a new public.campaign_templates table keyed by
-- alert kind so admins can iterate on copy without a code deploy. The
-- four kinds shipped in this migration mirror the JS templates exactly.
--
-- Idempotency: the trigger checks campaign_id IS NULL before firing,
-- and the campaign slug is alert-id-derived to be unique per alert.
-- ROLLBACK: drop trigger + functions, the templates table can stay.
-- ============================================================

-- ----------------------------------------
-- 1. Templates table — admin-editable per alert kind
-- ----------------------------------------
create table if not exists public.campaign_templates (
  id uuid primary key default gen_random_uuid(),
  -- match-key. NULL = default fallback used when no kind-specific match.
  alert_kind text,                       -- bill_event | bop_hearing | ag_enforcement | fda_action | dea_action | null
  -- optional secondary match: only use this template if alert.title ILIKE this
  title_match text,                      -- e.g. '%city%' for the Marshall-style city ordinance template
  -- subject + body with token placeholders. tokens supported by the trigger:
  --   {{locality_name}}      — "the federal level" / "the national level" / two-letter state
  --   {{source_line}}        — "\n\nSource: <url>" or empty
  --   {{recipient_title}}    — placeholder kept verbatim for client-side render
  --   {{recipient_last_name}}
  --   {{full_name}} {{city}} {{state}}
  subject_template text not null,
  body_template text not null,
  -- ordering tiebreaker when multiple rows match (highest first wins)
  priority int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_campaign_templates_kind
  on public.campaign_templates (alert_kind, priority desc)
  where active;

alter table public.campaign_templates enable row level security;

drop policy if exists campaign_templates_read on public.campaign_templates;
create policy campaign_templates_read on public.campaign_templates
  for select to public using (active);

drop policy if exists campaign_templates_admin on public.campaign_templates;
create policy campaign_templates_admin on public.campaign_templates
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ----------------------------------------
-- 2. Seed the four templates from auto-campaign-from-alert.mjs
-- ----------------------------------------
-- Idempotent: delete any existing seed rows first (matched by a marker
-- in the subject — fragile but acceptable for v1; if admins edit the
-- seed copy, they should also bump the marker).
delete from public.campaign_templates
 where subject_template like 'Re: kratom-related ordinance in {{locality_name}} %'
    or subject_template like 'Public comment on kratom-related agenda item %'
    or subject_template like 'Concern about scope of kratom enforcement %'
    or subject_template like 'Kratom policy in {{locality_name}} %';

insert into public.campaign_templates (alert_kind, title_match, priority, subject_template, body_template) values

-- City ordinance (bill_event w/ "city" in title) — highest priority
('bill_event', '%city%', 100,
 'Re: kratom-related ordinance in {{locality_name}} — please consider the alkaloid distinction',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing as a member of the kratom advocacy community regarding the recent kratom-related action in {{locality_name}}.\n\n' ||
 E'A growing body of state legislation — including bills in New Hampshire, Ohio, and elsewhere — distinguishes between natural leaf kratom (the plant in its traditional form) and 7-hydroxymitragynine-enriched or synthetic kratom products. The legitimate industry supports restrictions on enriched and synthetic products. We oppose conflating those products with natural leaf, which has been used safely for centuries and is supported by a substantial harm-reduction literature.\n\n' ||
 E'I respectfully ask that any local action preserve access to natural-leaf kratom while addressing the documented concerns about enriched/synthetic derivatives.\n\n' ||
 E'If your jurisdiction has not yet acted, the Kratom Consumer Protection Act (KCPA) framework — already adopted by eight states — provides a tested model that distinguishes legitimate products from concerning ones, including age limits, labeling requirements, and a 7-OH cap.\n\n' ||
 E'Background and platform: https://www.ikratom.org{{source_line}}\n\n' ||
 E'Thank you for your time and consideration.\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- BoP hearing
('bop_hearing', null, 90,
 'Public comment on kratom-related agenda item — {{locality_name}} Board of Pharmacy',
 E'Dear Board members,\n\n' ||
 E'I submit this public comment regarding kratom-related items on the upcoming agenda.\n\n' ||
 E'I urge the Board to distinguish carefully between natural leaf kratom and 7-hydroxymitragynine-enriched or synthetic kratom products. The legitimate industry supports restrictions on enriched and synthetic derivatives — what we oppose is broad scheduling that captures the natural plant.\n\n' ||
 E'The federal National Drug Control Strategy 2026 (May 2026, ONDCP) explicitly distinguishes 7-OH-enriched products from natural leaf in its enforcement framework. State boards adopting that same distinction protect consumers without criminalizing a substance with documented harm-reduction benefits.\n\n' ||
 E'Source: {{source_url_or_default}}\nBriefing: https://www.ikratom.org/briefings/ndcs-2026\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- AG enforcement / FDA / DEA action
('ag_enforcement', null, 80,
 'Concern about scope of kratom enforcement in {{locality_name}}',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing regarding the recent kratom-related enforcement action in {{locality_name}}.\n\n' ||
 E'I support enforcement against 7-hydroxymitragynine-enriched, synthetically altered, or mislabeled kratom products. I am concerned, however, when enforcement language conflates those products with natural-leaf kratom, which has a different chemical profile, a long history of traditional use, and growing peer-reviewed literature documenting its role in harm reduction for opioid dependence.\n\n' ||
 E'I respectfully ask that future enforcement and policy communication make this distinction explicit.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

('fda_action', null, 80,
 'Concern about scope of kratom enforcement in {{locality_name}}',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing regarding the recent kratom-related enforcement action in {{locality_name}}.\n\n' ||
 E'I support enforcement against 7-hydroxymitragynine-enriched, synthetically altered, or mislabeled kratom products. I am concerned, however, when enforcement language conflates those products with natural-leaf kratom, which has a different chemical profile, a long history of traditional use, and growing peer-reviewed literature documenting its role in harm reduction for opioid dependence.\n\n' ||
 E'I respectfully ask that future enforcement and policy communication make this distinction explicit.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

('dea_action', null, 80,
 'Concern about scope of kratom enforcement in {{locality_name}}',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing regarding the recent kratom-related enforcement action in {{locality_name}}.\n\n' ||
 E'I support enforcement against 7-hydroxymitragynine-enriched, synthetically altered, or mislabeled kratom products. I am concerned, however, when enforcement language conflates those products with natural-leaf kratom, which has a different chemical profile, a long history of traditional use, and growing peer-reviewed literature documenting its role in harm reduction for opioid dependence.\n\n' ||
 E'I respectfully ask that future enforcement and policy communication make this distinction explicit.\n\n' ||
 E'Source: {{source_url}}\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'),

-- Default fallback (alert_kind null) — generic state/news event
(null, null, 0,
 'Kratom policy in {{locality_name}} — please preserve natural leaf access',
 E'Dear {{recipient_title}} {{recipient_last_name}},\n\n' ||
 E'I''m writing as a member of the kratom advocacy community regarding recent policy activity in {{locality_name}}.\n\n' ||
 E'Modern kratom legislation — including the federal NDCS 2026 framework and bills like NH SB 557 — distinguishes between natural leaf kratom (the plant) and 7-hydroxymitragynine-enriched / synthetic derivatives. The first preserves a centuries-old plant medicine; the second targets concerning new products.\n\n' ||
 E'I support sensible regulation that maintains this distinction. The Kratom Consumer Protection Act framework — adopted in eight states — is the tested model.\n\n' ||
 E'Source: {{source_url}}\nBriefing: https://www.ikratom.org/briefings/ndcs-2026\n\n' ||
 E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}');

-- ----------------------------------------
-- 3. Targeting helper — pick the best legislator slate for an alert
-- ----------------------------------------
-- Returns a row with target_legislator_ids[], target_roles[], target_locality, tier.
-- Mirrors pickTargets() in auto-campaign-from-alert.mjs exactly.
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
begin
  -- Tier 1: city/county officials (state alert with "City, ST" title prefix)
  if p_alert.locality ~ '^[A-Z]{2}$' then
    v_city_name := substring(p_alert.title from '^([A-Z][a-zA-Z\s]+),\s+([A-Z]{2})');
    if v_city_name is not null and length(trim(v_city_name)) > 0 then
      select array_agg(id) into v_ids
      from public.legislators
      where state = p_alert.locality
        and locality ilike '%' || trim(v_city_name) || '%'
        and role in ('city_council', 'mayor')
        and active = true;
      if v_ids is not null and array_length(v_ids, 1) > 0 then
        return query select v_ids,
                            array['city_council','mayor']::text[],
                            trim(v_city_name),
                            'city'::text;
        return;
      end if;
    end if;
  end if;

  -- Tier 2: BoP hearing — return empty target_ids; campaign will pull contact from bop_boards
  if p_alert.kind = 'bop_hearing' and p_alert.bop_board_id is not null then
    return query select array[]::uuid[],
                        array[]::text[],
                        null::text,
                        'bop'::text;
    return;
  end if;

  -- Tier 3: state legislators
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
-- 4. Template lookup helper — pick best template for an alert kind+title
-- ----------------------------------------
create or replace function public.pick_template_for_alert(p_alert public.policy_alerts)
returns public.campaign_templates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl public.campaign_templates;
begin
  -- Try kind+title_match (highest priority)
  select * into v_tpl
  from public.campaign_templates
  where active
    and alert_kind = p_alert.kind
    and title_match is not null
    and p_alert.title ilike title_match
  order by priority desc
  limit 1;
  if found then return v_tpl; end if;

  -- Try kind alone
  select * into v_tpl
  from public.campaign_templates
  where active
    and alert_kind = p_alert.kind
    and title_match is null
  order by priority desc
  limit 1;
  if found then return v_tpl; end if;

  -- Fall back to default (alert_kind is null)
  select * into v_tpl
  from public.campaign_templates
  where active
    and alert_kind is null
  order by priority desc
  limit 1;
  return v_tpl;  -- nullable record if no default seeded
end;
$$;

-- ----------------------------------------
-- 5. Token-rendering helper
-- ----------------------------------------
create or replace function public.render_template_for_alert(
  p_template text,
  p_alert public.policy_alerts
)
returns text
language plpgsql
immutable
as $$
declare
  v_locality_name text;
  v_source_line text;
  v_source_url text;
  v_out text;
begin
  if p_template is null then return null; end if;

  v_locality_name := case
    when p_alert.locality = 'FED' then 'the federal level'
    when p_alert.locality = 'ALL' then 'the national level'
    else p_alert.locality
  end;
  v_source_line := case
    when p_alert.source_url is not null then E'\n\nSource: ' || p_alert.source_url
    else ''
  end;
  v_source_url := coalesce(p_alert.source_url, '');

  v_out := p_template;
  v_out := replace(v_out, '{{locality_name}}', v_locality_name);
  v_out := replace(v_out, '{{source_line}}', v_source_line);
  v_out := replace(v_out, '{{source_url}}', v_source_url);
  v_out := replace(v_out, '{{source_url_or_default}}',
    case when length(v_source_url) > 0 then v_source_url else '(see ikratom.org)' end);
  -- {{recipient_title}}, {{recipient_last_name}}, {{full_name}}, {{city}}, {{state}}
  -- are intentionally NOT replaced here — they're rendered per-recipient at
  -- mailto: build time by the existing campaigns/actions module.
  return v_out;
end;
$$;

-- ----------------------------------------
-- 6. Slug builder — same rules as the JS (locality + first-6-words-of-title, 80-char cap)
-- ----------------------------------------
create or replace function public.build_alert_campaign_slug(p_alert public.policy_alerts)
returns text
language plpgsql
immutable
as $$
declare
  v_words text;
  v_slug text;
begin
  v_words := lower(coalesce(p_alert.title, ''));
  v_words := regexp_replace(v_words, '[^a-z0-9\s-]', '', 'g');
  v_words := array_to_string(
    (string_to_array(regexp_replace(v_words, '\s+', ' ', 'g'), ' '))[1:6],
    '-'
  );
  v_words := regexp_replace(v_words, '-+', '-', 'g');
  v_slug := 'alert-' || lower(p_alert.locality) || '-' || v_words;
  -- collision-safety: append short alert id suffix; keeps slug unique even if
  -- two alerts share an identical title prefix in the same locality.
  v_slug := v_slug || '-' || substring(p_alert.id::text, 1, 6);
  return left(v_slug, 80);
end;
$$;

-- ----------------------------------------
-- 7. Trigger function — generate the campaign + link back
-- ----------------------------------------
create or replace function public.auto_campaign_on_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_targets record;
  v_tpl public.campaign_templates;
  v_subject text;
  v_body text;
  v_blurb text;
  v_state text;
  v_slug text;
  v_campaign_id uuid;
begin
  -- Only fire when the alert is approved + actionable + has no campaign yet.
  if new.moderation_status <> 'approved' then return new; end if;
  if new.action_required <> true then return new; end if;
  if new.campaign_id is not null then return new; end if;

  -- On UPDATE, only fire when one of the trigger predicates *flipped* —
  -- otherwise editing an alert's body would re-fire and create dupes.
  if tg_op = 'UPDATE' then
    if old.moderation_status = 'approved'
       and old.action_required = true
       and old.campaign_id is null
    then
      -- Already in the "should-fire" state before this update; let the
      -- prior trigger run own this. Avoids double-fire on any column edit.
      return new;
    end if;
  end if;

  -- Pick targets + template
  select * into v_targets from public.pick_targets_for_alert(new);
  v_tpl := public.pick_template_for_alert(new);
  if v_tpl.subject_template is null then
    raise warning 'auto_campaign_on_alert: no template found for alert % (kind=%)', new.id, new.kind;
    return new;
  end if;

  v_subject := public.render_template_for_alert(v_tpl.subject_template, new);
  v_body := public.render_template_for_alert(v_tpl.body_template, new);
  v_blurb := left(coalesce(split_part(new.body, E'\n', 1), ''), 260);
  v_state := case when new.locality ~ '^[A-Z]{2}$' then new.locality else null end;
  v_slug := public.build_alert_campaign_slug(new);

  -- Insert campaign
  insert into public.campaigns (
    slug, state, title, blurb,
    subject_template, body_template,
    target_legislator_ids, target_roles, target_locality,
    mobilization_type, allow_non_residents, auto_generated,
    review_state, active,
    starts_at, ends_at,
    ai_personalize
  ) values (
    v_slug, v_state, left(new.title, 200), nullif(v_blurb, ''),
    left(v_subject, 998), v_body,
    case when array_length(v_targets.target_legislator_ids, 1) > 0
         then v_targets.target_legislator_ids else null end,
    case when array_length(v_targets.target_roles, 1) > 0
         then v_targets.target_roles else null end,
    v_targets.target_locality,
    'solidarity', true, true,
    'pending_review', false,
    now(), new.expires_at,
    false
  )
  returning id into v_campaign_id;

  -- Link alert → campaign. Use direct UPDATE on NEW so the row written by
  -- this transaction reflects the link without recursing.
  new.campaign_id := v_campaign_id;
  return new;
exception
  when unique_violation then
    -- Slug collision (rare; e.g. two alerts in same locality with same title).
    -- Log + carry on so the alert insert/update isn't blocked.
    raise warning 'auto_campaign_on_alert: slug collision for alert %, skipping', new.id;
    return new;
  when others then
    -- Never block alert writes on auto-campaign generation.
    raise warning 'auto_campaign_on_alert failed for alert %: %', new.id, sqlerrm;
    return new;
end;
$$;

-- ----------------------------------------
-- 8. Wire the trigger
-- ----------------------------------------
drop trigger if exists trg_auto_campaign_on_alert on public.policy_alerts;
create trigger trg_auto_campaign_on_alert
  before insert or update of moderation_status, action_required, campaign_id
  on public.policy_alerts
  for each row
  execute function public.auto_campaign_on_alert();

comment on trigger trg_auto_campaign_on_alert on public.policy_alerts is
  'Phase 4: auto-creates a solidarity campaign in real-time when a policy_alert is approved + action_required and has no campaign_id yet. Replaces hourly auto-campaign-from-alert cron step. See migration 0068.';

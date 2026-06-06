-- 0178_gate_auto_campaign_kinds.sql
-- Only TRUE legislative / regulatory actions auto-generate a campaign.
--
-- auto_campaign_on_alert() (0074) fired on ANY approved + action_required alert
-- with no check on `kind`, so a product recall (fda_action) auto-created a
-- campaign targeting all of Congress. Recalls, FDA/DEA actions, court rulings,
-- and breaking news are informational — "email your senator about a product
-- recall" isn't a real action. Gate: bills/ordinances (bill_event) + BoP
-- hearings ALWAYS become campaigns; agency (fda/dea) actions become campaigns
-- ONLY when the title is a ban/scheduling push (the 7-OH fight), never a
-- recall/lawsuit/enforcement/court/warning. Everything else stays an alert.
-- Mirrors scripts/lib/campaign-eligibility.mjs.
--
-- This is a faithful copy of the 0074 function with ONE added guard. Rollback:
-- re-run the 0074 definition (without the kind/title guard).

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
  if new.moderation_status <> 'approved' then return new; end if;
  if new.action_required <> true then return new; end if;
  if new.campaign_id is not null then return new; end if;

  -- Only true ACTIONS become campaigns (mirrors scripts/lib/campaign-eligibility.mjs):
  --   • bills / local ordinances (bill_event) + BoP hearings (bop_hearing) — always
  --   • agency (fda/dea) actions ONLY when the title is a ban/scheduling PUSH
  --     (the 7-OH fight), NOT a recall / lawsuit / enforcement / court ruling /
  --     warning / news.
  -- Everything else stays an informational alert (a product recall auto-created
  -- a Congress-wide campaign before this gate).
  if not (
    new.kind in ('bill_event', 'bop_hearing')
    or (
      new.kind in ('fda_action', 'dea_action')
      and new.title !~* '\y(recall|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz|seized|seizure|cease|warn|warning|navy|military)\y'
      and new.title ~* '\y(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\y'
    )
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.moderation_status = 'approved'
       and old.action_required = true
       and old.campaign_id is null
    then
      return new;
    end if;
  end if;

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

  insert into public.campaigns (
    slug, state, bill_id, title, blurb,
    subject_template, body_template,
    target_legislator_ids, target_roles, target_locality,
    mobilization_type, allow_non_residents, auto_generated,
    review_state, active,
    starts_at, ends_at,
    ai_personalize
  ) values (
    v_slug, v_state, new.bill_id, left(new.title, 200), nullif(v_blurb, ''),
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

  new.campaign_id := v_campaign_id;
  return new;
exception
  when unique_violation then
    raise warning 'auto_campaign_on_alert: slug collision for alert %, skipping', new.id;
    return new;
  when others then
    raise warning 'auto_campaign_on_alert failed for alert %: %', new.id, sqlerrm;
    return new;
end;
$$;

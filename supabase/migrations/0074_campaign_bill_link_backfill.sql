-- ============================================================
-- 0074_campaign_bill_link_backfill
--
-- Two changes:
--
-- 1. Backfill campaigns.bill_id from policy_alerts.bill_id for any
--    auto-generated campaign whose alert is linked to a bill but
--    whose campaign row never got the link. Without this, the
--    campaign page can't surface the bill's local_meta (meeting
--    time, mailing address, contact form, etc.) — which is why
--    the Marshall, IL campaign showed up with no actionable info
--    even though /bills/<id> had it.
--
-- 2. Update auto_campaign_on_alert trigger so it sets bill_id
--    when the alert has one. Same fix going forward.
-- ============================================================

-- ----------------------------------------
-- 1. Backfill campaigns.bill_id from linked alerts
-- ----------------------------------------
update public.campaigns c
   set bill_id = a.bill_id
  from public.policy_alerts a
 where a.campaign_id = c.id
   and a.bill_id is not null
   and c.bill_id is null
   and c.auto_generated = true;

-- ----------------------------------------
-- 2. Update the trigger to set bill_id going forward
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
  if new.moderation_status <> 'approved' then return new; end if;
  if new.action_required <> true then return new; end if;
  if new.campaign_id is not null then return new; end if;

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

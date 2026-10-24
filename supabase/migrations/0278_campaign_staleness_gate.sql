-- 0278_campaign_staleness_gate.sql
--
-- A staleness gate for the alert -> campaign trigger, and a `rule_filed`
-- alert kind for agency rule notices (intel step 1, all states).
--
-- Why: the trigger already vetoes a CONCLUDED bill (0197/0198), but nothing at
-- creation time checked the CLOCK. In May 2026, 2,092 of 2,639 auto-campaigns
-- were spawned from news more than 14 days old at creation; a backfill or a
-- late approval of an old pending alert still spawns one today. The gate skips:
--   * an alert whose expires_at has passed;
--   * a bop_hearing / rule_filed alert whose occurs_at (hearing or comment
--     date) is more than a day past;
--   * a linked bill whose session ended (bills.session_sine_die);
--   * a story older than 21 days: the linked news item's published_at, else
--     the alert's own created_at (an old pending alert approved today).
-- Mirrors scripts/lib/campaign-eligibility.mjs alertStaleReason() exactly.
--
-- rule_filed: an agency filed or proposed a rule (state register notice,
-- emergency rule, BoP rule). A filed rule opens a comment period, so it is a
-- real trigger and is campaign-eligible. The campaign still lands in
-- pending_review like every auto-campaign. Also adds ag_enforcement to the
-- kind check: src/modules/alerts/actions.ts has offered it on the public tip
-- form, but the constraint rejected every such submission.
--
-- Rollback: re-apply the 0213 definition of auto_campaign_on_alert, restore the
-- previous kind check (without rule_filed, ag_enforcement), and
-- delete from campaign_templates where alert_kind = 'rule_filed'.

alter table public.policy_alerts drop constraint if exists policy_alerts_kind_chk;
alter table public.policy_alerts add constraint policy_alerts_kind_chk check (kind = any (array[
  'bill_event', 'bop_hearing', 'fda_action', 'dea_action', 'news_break',
  'intel_tip', 'scraper_stale', 'briefing_published',
  'rule_filed', 'ag_enforcement'
]));

create or replace function public.auto_campaign_on_alert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_targets record;
  v_tpl public.campaign_templates;
  v_subject text;
  v_body text;
  v_blurb text;
  v_state text;
  v_slug text;
  v_campaign_id uuid;
  v_constraint text;
  v_story_at timestamptz;
begin
  if new.moderation_status <> 'approved' then return new; end if;
  if new.action_required <> true then return new; end if;
  if new.campaign_id is not null then return new; end if;

  -- Eligibility gate (mirrors scripts/lib/campaign-eligibility.mjs):
  --   • bills / local ordinances (bill_event), BoP hearings (bop_hearing) and
  --     filed agency rules (rule_filed, 0278) — always
  --   • agency (fda/dea) actions ONLY when the title is a ban/scheduling PUSH,
  --     NOT a recall / lawsuit / enforcement / court ruling / warning / news
  --   • AND (0183) NOT a pure procedural micro-step or already-concluded event
  --   • AND (0213) NOT a syndicated national-trend roundup (per-state fan-out)
  if not (
    (
      new.kind in ('bill_event', 'bop_hearing', 'rule_filed')
      or (
        new.kind in ('fda_action', 'dea_action')
        and new.title !~* '\y(recall|recalls|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz[a-z]*|cease|warn|warning|navy|military)\y'
        and new.title ~* '\y(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\y'
      )
    )
    and new.title !~* '(signed into law|signed by (the )?governor|enacted|chaptered|takes effect|effective date|now law|becomes law|applauds|rebuttal)'
    and new.title !~* '\y[0-9]+\s+more\s+states\y|\ymore\s+(u\.?s\.?\s+)?states\y|\yanother\s+state\y|\ynationwide\s+(ban|crackdown|crackdowns)\y|\yacross\s+the\s+(us|u\.s\.|country|nation)\y'
  ) then
    return new;
  end if;

  -- STRUCTURED CONCLUDED-BILL VETO (verbatim from 0198).
  if new.bill_id is not null then
    if exists (
      select 1 from public.bills b
       where b.id = new.bill_id
         and (
              b.status in ('enacted', 'dead')
           or b.active = false
           or b.last_action ~* '\yenacted\y|\ychaptered\y|\ypublic chapter\y|\ybecame (a )?(public )?law\y|\ybecame pub\y|\yacts of assembly\y|\yeffective date\y|\ysigned by (the )?governor\y|\ychapter\s+\d|\ypub\.? ?ch\.? ?\d|\yacts?,? (regular|special|extraordinary) session\y'
         )
    ) then
      return new;
    end if;
  end if;

  -- STALENESS GATE (0278). Mirrors alertStaleReason() in campaign-eligibility.mjs.
  if new.expires_at is not null and new.expires_at < now() then return new; end if;
  if new.kind in ('bop_hearing', 'rule_filed')
     and new.occurs_at is not null and new.occurs_at < now() - interval '1 day' then
    return new;
  end if;
  if new.bill_id is not null and exists (
    select 1 from public.bills b where b.id = new.bill_id and b.session_sine_die is true
  ) then
    return new;
  end if;
  if new.source_url is not null then
    select n.published_at into v_story_at
      from public.news_items n where n.url = new.source_url limit 1;
  end if;
  if coalesce(v_story_at, new.created_at, now()) < now() - interval '21 days' then
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
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'ux_campaigns_topic_key_live' then
      select id into v_campaign_id
        from public.campaigns
        where topic_key = public.campaign_topic_key(v_state, left(new.title, 200))
          and review_state in ('pending_review', 'auto_active', 'manual')
        order by created_at asc
        limit 1;
      if v_campaign_id is not null then
        new.campaign_id := v_campaign_id;
      end if;
      return new;
    end if;
    raise warning 'auto_campaign_on_alert: slug collision for alert %, skipping', new.id;
    return new;
  when others then
    raise warning 'auto_campaign_on_alert failed for alert %: %', new.id, sqlerrm;
    return new;
end;
$function$;

-- A neutral template for a filed rule. Targets fall to the state legislature
-- (pick_targets_for_alert tier 3); a reviewer can retarget to the agency
-- before approving. Same scope-and-evidence framing as the other kinds.
insert into public.campaign_templates (alert_kind, title_match, priority, active, subject_template, body_template)
select 'rule_filed', null, 85, true,
  'Proposed kratom rule in {{locality_name}}: request for a clear scope and open comment',
  E'Dear {{recipient_title}} {{recipient_last_name}},\n\n'
  || E'A state agency in {{locality_name}} has filed or proposed a rule that addresses kratom-related products. I am writing to ask for your attention to it while the public comment period is open.\n\n'
  || E'"Kratom" covers products with different chemistry: the natural leaf, mitragynine, 7-hydroxymitragynine in concentrated form, mitragynine pseudoindoxyl, and synthetic or semi-synthetic analogues. A rule that does not say which of these it covers can reach far beyond what its authors intend.\n\n'
  || E'I respectfully ask that the rule:\n'
  || E'- Name the specific compounds and product forms in scope\n'
  || E'- Cite the evidence behind that scope\n'
  || E'- Keep a full public comment period and publish the agency''s responses\n\n'
  || E'I am not asking you to take a side. I am asking that the decision rest on a clear public record.\n\n'
  || E'Sincerely,\n{{full_name}}\n{{city}}, {{state}}'
where not exists (select 1 from public.campaign_templates where alert_kind = 'rule_filed');

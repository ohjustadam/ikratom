-- 0197_concluded_bill_eligibility.sql
-- CREATE OR REPLACE auto_campaign_on_alert() (latest body = 0183) with ONE
-- addition; everything else is verbatim from 0183.
--
-- STRUCTURED CONCLUDED-BILL VETO (mirrors scripts/lib/campaign-eligibility.mjs
-- isBillConcluded). PROBLEM (confirmed in prod 2026-06-12 during a manual
-- campaign review): the engine + this trigger approved/spawned campaigns for
-- bills that are ALREADY ENACTED. The bills.status enum lags reality — AL SB 273,
-- TN SB 1390, VA HB 1307 all sit at status='passed_chamber' while their official
-- last_action reads 'Enacted' / 'became Pub. Ch. 502' / 'Acts of Assembly Chapter'.
-- A "contact your officials to oppose it" campaign for an in-force law is moot.
--
-- FIX: when an alert links a bill (new.bill_id), skip the spawn if that bill is
-- enacted/dead (status), inactive (active=false), OR its last_action shows a
-- concluded legislative action. This is driven by STRUCTURED bill data, NOT the
-- news headline — a title regex was deliberately rejected because it would
-- false-positive on the veto-push window we keep actionable on purpose
-- ("delivered to the governor", "engrossed", "passed the senate" all stay live).
-- CONCLUDED_RE (the headline-based gate added in 0183) is unchanged.
--
-- Rollback: re-apply the 0183 function body.

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
  v_constraint text;
begin
  if new.moderation_status <> 'approved' then return new; end if;
  if new.action_required <> true then return new; end if;
  if new.campaign_id is not null then return new; end if;

  -- Eligibility gate (mirrors scripts/lib/campaign-eligibility.mjs):
  --   • bills / local ordinances (bill_event) + BoP hearings (bop_hearing) — always
  --   • agency (fda/dea) actions ONLY when the title is a ban/scheduling PUSH,
  --     NOT a recall / lawsuit / enforcement / court ruling / warning / news
  --   • AND (NEW in 0183) the title must NOT be a pure procedural micro-step or
  --     an already-concluded event — those are informational regardless of kind.
  if not (
    (
      new.kind in ('bill_event', 'bop_hearing')
      or (
        new.kind in ('fda_action', 'dea_action')
        and new.title !~* '\y(recall|recalls|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz|seizes|seizing|seized|seizure|cease|warn|warning|navy|military)\y'
        and new.title ~* '\y(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\y'
      )
    )
    -- NEGATIVE GATE: ALREADY-CONCLUDED events + commentary only. We deliberately
    -- do NOT veto live procedural states (enrolled/engrossed/reported favorably/
    -- delivered to governor) — a bill in motion is still actionable (esp. a
    -- veto-push once it's on the governor's desk). Mirrors campaign-eligibility.mjs.
    and new.title !~* '(signed into law|signed by (the )?governor|enacted|chaptered|takes effect|effective date|now law|becomes law|applauds|rebuttal)'
  ) then
    return new;
  end if;

  -- STRUCTURED CONCLUDED-BILL VETO (mirrors isBillConcluded): if this alert links
  -- a bill that is already enacted/dead/chaptered/in force, the event is moot —
  -- do not spawn. Driven by bill status + official last_action (the status enum
  -- lags), never the news title. Live procedural last_actions ("Delivered to
  -- Governor", "Engrossed", "Passed Senate") intentionally do NOT match.
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
    -- Distinguish the topic-key dedup index from a slug collision.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'ux_campaigns_topic_key_live' then
      -- A live/pending campaign already covers this topic cluster. Link THIS
      -- alert to the canonical one (the 0107/0108-intended auto-link) so we
      -- never leave an orphan pending campaign — and the auto-approve engine's
      -- "every candidate resolves an alert" precondition holds.
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
$$;

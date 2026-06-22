-- 0213_veto_national_syndication_campaigns.sql
-- CREATE OR REPLACE auto_campaign_on_alert() (latest body = 0198) with ONE added
-- negative-gate line; everything else is verbatim from 0198.
--
-- PER-STATE FAN-OUT FIX (mirrors scripts/lib/campaign-eligibility.mjs
-- NATIONAL_SYNDICATION_RE). A syndicated national trend/roundup headline — "Why 2
-- more states will soon ban kratom", "...as more US states push bans", "banned in
-- another state amid nationwide crackdowns" — is auto-tagged to a state by the
-- per-state RSS and then fans out into one near-identical campaign PER state, none
-- tied to a specific local bill/action. That single article → 7 campaigns was the
-- dominant pending-queue-noise source in the 2026-06-22 audit (7 of 28 pending).
-- These are awareness, not a state-specific CTA, so they no longer spawn a
-- campaign. CONSERVATIVE: fires only on explicit multi-state / nationwide framing,
-- never on a single named state's own action ("Delaware bill clears House").
--
-- Rollback: re-apply the 0198 function body (drop the second negative-gate line).

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
  --   • AND (0183) NOT a pure procedural micro-step or already-concluded event
  --   • AND (0213) NOT a syndicated national-trend roundup (per-state fan-out)
  if not (
    (
      new.kind in ('bill_event', 'bop_hearing')
      or (
        new.kind in ('fda_action', 'dea_action')
        and new.title !~* '\y(recall|recalls|recalled|sue|sues|sued|lawsuit|arrest|arrested|indict|judge|court|ruling|ruled|settle|settlement|seiz[a-z]*|cease|warn|warning|navy|military)\y'
        and new.title ~* '\y(ban|bans|banned|banning|schedule|scheduled|scheduling|classif|classified|prohibit|prohibits|restrict|restricts|outlaw)\y'
      )
    )
    -- NEGATIVE GATE: ALREADY-CONCLUDED events + commentary (verbatim from 0198).
    and new.title !~* '(signed into law|signed by (the )?governor|enacted|chaptered|takes effect|effective date|now law|becomes law|applauds|rebuttal)'
    -- NEGATIVE GATE 2 (0213): syndicated national-trend roundups. Mirrors
    -- campaign-eligibility.mjs NATIONAL_SYNDICATION_RE.
    and new.title !~* '\y[0-9]+\s+more\s+states\y|\ymore\s+(u\.?s\.?\s+)?states\y|\yanother\s+state\y|\ynationwide\s+(ban|crackdown|crackdowns)\y|\yacross\s+the\s+(us|u\.s\.|country|nation)\y'
  ) then
    return new;
  end if;

  -- STRUCTURED CONCLUDED-BILL VETO (verbatim from 0198): a linked bill already
  -- enacted/dead/in-force is moot — do not spawn.
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
$$;
